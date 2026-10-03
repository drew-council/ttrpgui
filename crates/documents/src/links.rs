use crate::{Catalogue, DocumentId};
use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::{
    ops::Range,
    path::{Component, Path, PathBuf},
};

const LINK_COMPONENT: &percent_encoding::AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkKind {
    Markdown,
    Wiki,
}
#[derive(Clone, Debug)]
pub struct Link {
    pub span: Range<usize>,
    pub target: String,
    pub heading: Option<String>,
    pub label: Option<String>,
    pub kind: LinkKind,
    /// Exact source destination, excluding label/heading, when safely editable.
    pub destination: Option<Range<usize>>,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Resolution {
    Found {
        document: DocumentId,
        heading: Option<String>,
    },
    Ambiguous(Vec<DocumentId>),
    Missing,
    External,
}

fn target_parts(value: &str) -> (String, Option<String>) {
    let (target, heading) = value
        .split_once('#')
        .map_or((value, None), |(a, b)| (a, Some(b.to_owned())));
    (target.to_owned(), heading)
}

pub fn parse_links(source: &str) -> Vec<Link> {
    let mut links = Vec::new();
    let mut excluded = Vec::<Range<usize>>::new();
    let mut code_start = None;
    let options = Options::all() - Options::ENABLE_WIKILINKS;
    for (event, span) in Parser::new_ext(source, options).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code_start = Some(span.start),
            Event::End(TagEnd::CodeBlock) => {
                if let Some(start) = code_start.take() {
                    excluded.push(start..span.end);
                }
            }
            Event::Code(_) | Event::Html(_) | Event::InlineHtml(_) => excluded.push(span),
            Event::Start(Tag::Link { dest_url, .. }) => {
                let (target, heading) = target_parts(&dest_url);
                let raw = &source[span.clone()];
                // Reference links still resolve, but are preserved on rewrites
                // unless their destination has an unambiguous source span.
                let destination = raw.find("](").and_then(|start| {
                    let offset = start + 2;
                    raw[offset..].find(dest_url.as_ref()).map(|index| {
                        let start = span.start + offset + index;
                        start..start + target.len()
                    })
                });
                links.push(Link {
                    span: span.clone(),
                    target,
                    heading,
                    label: None,
                    kind: LinkKind::Markdown,
                    destination,
                });
            }
            _ => (),
        }
    }
    let mut offset = 0;
    while let Some(start) = source[offset..].find("[[").map(|i| i + offset) {
        offset = start + 2;
        if excluded.iter().any(|r| r.contains(&start))
            || source[..start]
                .chars()
                .rev()
                .take_while(|c| *c == '\\')
                .count()
                % 2
                == 1
        {
            continue;
        }
        let Some(end) = source[offset..].find("]]").map(|i| i + offset) else {
            break;
        };
        let inner = &source[offset..end];
        if inner.contains('\n') {
            continue;
        }
        let (destination, label) = inner
            .split_once('|')
            .map_or((inner, None), |(a, b)| (a, Some(b.to_owned())));
        let (target, heading) = target_parts(destination);
        links.push(Link {
            span: start..end + 2,
            destination: Some(offset..offset + target.len()),
            target,
            heading,
            label,
            kind: LinkKind::Wiki,
        });
        offset = end + 2;
    }
    links
}

pub fn heading_offset(source: &str, fragment: &str) -> Option<usize> {
    let fragment = percent_decode_str(fragment)
        .decode_utf8_lossy()
        .to_lowercase();
    let mut heading = None;
    let mut title = String::new();
    let mut duplicates = std::collections::BTreeMap::<String, usize>::new();
    for (event, range) in Parser::new(source).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { .. }) => {
                heading = Some(range.start);
                title.clear();
            }
            Event::Text(text) | Event::Code(text) if heading.is_some() => title.push_str(&text),
            Event::End(TagEnd::Heading(_)) => {
                let start = heading.take()?;
                let slug = title
                    .to_lowercase()
                    .chars()
                    .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '-' || *c == '_')
                    .map(|c| if c.is_whitespace() { '-' } else { c })
                    .collect::<String>();
                let occurrence = duplicates.entry(slug.clone()).or_default();
                let unique = if *occurrence == 0 {
                    slug
                } else {
                    format!("{slug}-{}", *occurrence)
                };
                *occurrence += 1;
                if title.to_lowercase() == fragment || unique == fragment {
                    return Some(start);
                }
            }
            _ => (),
        }
    }
    None
}

fn normalize(path: &Path) -> Option<PathBuf> {
    let mut parts = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(s) => parts.push(s),
            Component::CurDir => (),
            Component::ParentDir => {
                if !parts.pop() {
                    return None;
                }
            }
            _ => return None,
        }
    }
    Some(parts)
}

impl Catalogue {
    pub fn resolve(&self, from: DocumentId, link: &Link) -> Resolution {
        if link.target.contains("://") || link.target.starts_with("mailto:") {
            return Resolution::External;
        }
        let Some(source) = self.documents.get(&from) else {
            return Resolution::Missing;
        };
        if link.target.is_empty() {
            return Resolution::Found {
                document: from,
                heading: link.heading.clone(),
            };
        }
        let decoded = percent_decode_str(&link.target).decode_utf8_lossy();
        let path = source
            .path
            .parent()
            .and_then(|p| normalize(&p.join(decoded.as_ref())));
        let by_path = path.and_then(|p| self.documents.values().find(|d| d.path == p));
        if let Some(document) = by_path {
            return Resolution::Found {
                document: document.id,
                heading: link.heading.clone(),
            };
        }
        if link.kind == LinkKind::Markdown {
            return Resolution::Missing;
        }
        let name = link.target.trim().to_lowercase();
        let candidates: Vec<_> = self
            .documents
            .values()
            .filter(|d| {
                d.name.to_lowercase() == name || d.aliases.iter().any(|a| a.to_lowercase() == name)
            })
            .map(|d| d.id)
            .collect();
        match candidates.as_slice() {
            [id] => Resolution::Found {
                document: *id,
                heading: link.heading.clone(),
            },
            [] => Resolution::Missing,
            _ => Resolution::Ambiguous(candidates),
        }
    }

    pub fn relative_link(
        &self,
        from: DocumentId,
        to: DocumentId,
        heading: Option<&str>,
    ) -> Option<String> {
        let source = self.documents.get(&from)?;
        let target = self.documents.get(&to)?;
        let path = pathdiff::diff_paths(&target.path, source.path.parent()?)?;
        let destination = encode_path(&path);
        let fragment = heading
            .map(|s| format!("#{}", utf8_percent_encode(s, LINK_COMPONENT)))
            .unwrap_or_default();
        let label = target
            .name
            .replace('\\', "\\\\")
            .replace('[', "\\[")
            .replace(']', "\\]");
        Some(format!("[{label}]({destination}{fragment})"))
    }
}

fn encode_path(path: &Path) -> String {
    path.to_string_lossy()
        .split('/')
        .map(|part| {
            if part == ".." {
                part.to_owned()
            } else {
                utf8_percent_encode(part, LINK_COMPONENT).to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[derive(Debug)]
pub struct LinkEdit {
    pub range: Range<usize>,
    pub replacement: String,
}

/// Build reviewable edits using the old catalogue to resolve identity. Apply in
/// reverse source order as one editor transaction. Ambiguous/unsupported links
/// are retained verbatim, never guessed.
pub fn links_after_change(
    source: &str,
    from: DocumentId,
    before: &Catalogue,
    after: &Catalogue,
) -> Vec<LinkEdit> {
    let mut edits = Vec::new();
    for link in parse_links(source) {
        let Resolution::Found { document, .. } = before.resolve(from, &link) else {
            continue;
        };
        let (Some(range), Some(target), Some(origin)) = (
            link.destination,
            after.documents.get(&document),
            after.documents.get(&from),
        ) else {
            continue;
        };
        if let (Some(old_target), Some(old_origin)) =
            (before.documents.get(&document), before.documents.get(&from))
        {
            if old_target.name == target.name
                && old_target.path == target.path
                && old_origin.path == origin.path
            {
                continue;
            }
        }
        let replacement = match link.kind {
            LinkKind::Wiki => target.name.clone(),
            LinkKind::Markdown => {
                let Some(path) = origin
                    .path
                    .parent()
                    .and_then(|parent| pathdiff::diff_paths(&target.path, parent))
                else {
                    continue;
                };
                encode_path(&path)
            }
        };
        if source[range.clone()] != replacement {
            edits.push(LinkEdit { range, replacement });
        }
    }
    edits.sort_by(|a, b| b.range.start.cmp(&a.range.start));
    edits
}
