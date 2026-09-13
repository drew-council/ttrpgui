mod links;
mod templates;
pub use links::*;
pub use templates::*;

use campaign_domain::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum DocumentId {
    Creature(CreatureId),
    Location(LocationId),
    Session(SessionId),
    Encounter(EncounterId),
    Note(NoteId),
}
impl DocumentId {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Creature(_) => "Creature",
            Self::Location(_) => "Location",
            Self::Session(_) => "Session",
            Self::Encounter(_) => "Encounter",
            Self::Note(_) => "Note",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Document {
    pub id: DocumentId,
    pub name: String,
    pub aliases: Vec<String>,
    pub path: PathBuf,
    pub portrait: Option<PathBuf>,
    search_names: Vec<String>,
}

#[derive(Default)]
pub struct Catalogue {
    pub documents: BTreeMap<DocumentId, Document>,
}
impl Catalogue {
    pub fn from_campaign(c: &Campaign) -> Self {
        let mut result = Self::default();
        let mut add =
            |id, name: &str, aliases: &[String], directory: String, portrait: &Option<String>| {
                let directory = PathBuf::from(directory);
                result.documents.insert(
                    id,
                    Document {
                        id,
                        name: name.into(),
                        aliases: aliases.into(),
                        path: directory.join("notes.md"),
                        portrait: portrait.as_ref().map(|p| directory.join(p)),
                        search_names: std::iter::once(name.to_lowercase())
                            .chain(aliases.iter().map(|a| a.to_lowercase()))
                            .collect(),
                    },
                );
            };
        for c in c.creatures.values() {
            add(
                DocumentId::Creature(c.id),
                &c.name,
                &c.aliases,
                format!("creatures/{}", c.id),
                &c.portrait,
            );
        }
        for l in c.locations.values() {
            add(
                DocumentId::Location(l.id),
                &l.name,
                &l.aliases,
                format!("locations/{}", l.id),
                &l.portrait,
            );
        }
        for s in c.sessions.values() {
            add(
                DocumentId::Session(s.id),
                &s.name,
                &s.aliases,
                format!("sessions/{}", s.id),
                &s.portrait,
            );
        }
        for n in c.notes.values() {
            add(
                DocumentId::Note(n.id),
                &n.name,
                &n.aliases,
                format!("notes/{}", n.id),
                &n.portrait,
            );
        }
        for e in c.encounters.values() {
            add(
                DocumentId::Encounter(e.id),
                &e.name,
                &e.aliases,
                campaign_storage::encounter_directory(e),
                &None,
            );
        }
        result
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<&Document> {
        let query = query.to_lowercase();
        let mut matches: Vec<_> = self
            .documents
            .values()
            .filter_map(|d| {
                d.search_names
                    .iter()
                    .filter_map(|name| fuzzy_score(&query, name))
                    .min()
                    .map(|score| (score, d))
            })
            .collect();
        matches.sort_by(|(sa, a), (sb, b)| {
            sa.cmp(sb)
                .then_with(|| a.name.cmp(&b.name))
                .then(a.id.cmp(&b.id))
        });
        matches.into_iter().take(limit).map(|(_, d)| d).collect()
    }

    pub fn related(&self, id: DocumentId, campaign: &Campaign) -> Vec<DocumentId> {
        let mut related = Vec::new();
        for encounter in campaign.encounters.values() {
            let encounter_id = DocumentId::Encounter(encounter.id);
            let relationships = std::iter::once(DocumentId::Session(encounter.session))
                .chain(encounter.location.map(DocumentId::Location))
                .chain(
                    encounter
                        .participants
                        .values()
                        .filter_map(|p| p.creature.map(DocumentId::Creature)),
                );
            for target in relationships {
                if encounter_id == id {
                    related.push(target);
                }
                if target == id {
                    related.push(encounter_id);
                }
            }
        }
        related.sort();
        related.dedup();
        related
    }
}

fn fuzzy_score(query: &str, candidate: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(0);
    }
    if let Some(index) = candidate.find(query) {
        return Some(index);
    }
    let mut wanted = query.chars();
    let mut next = wanted.next()?;
    let mut score = 100;
    for (index, c) in candidate.chars().enumerate() {
        if c == next {
            score += index;
            match wanted.next() {
                Some(c) => next = c,
                None => return Some(score),
            }
        }
    }
    None
}

/// Derived text only; the desktop's Zed buffer remains authoritative. Revision
/// checks prevent an older background parse from replacing a newer result.
#[derive(Default)]
pub struct SearchIndex {
    entries: BTreeMap<DocumentId, IndexedDocument>,
}
struct IndexedDocument {
    revision: u64,
    text: String,
    links: Vec<Link>,
}
pub struct PreparedDocument {
    id: DocumentId,
    document: IndexedDocument,
}
impl PreparedDocument {
    pub fn new(id: DocumentId, revision: u64, text: String) -> Self {
        let links = parse_links(&text);
        Self {
            id,
            document: IndexedDocument {
                revision,
                text,
                links,
            },
        }
    }
}
#[derive(Debug)]
pub struct TextMatch {
    pub document: DocumentId,
    pub line: usize,
    pub excerpt: String,
}
impl SearchIndex {
    pub fn update(&mut self, id: DocumentId, revision: u64, text: String) -> bool {
        self.apply(PreparedDocument::new(id, revision, text))
    }
    pub fn apply(&mut self, prepared: PreparedDocument) -> bool {
        let id = prepared.id;
        let revision = prepared.document.revision;
        if self
            .entries
            .get(&id)
            .is_some_and(|old| old.revision >= revision)
        {
            return false;
        }
        self.entries.insert(id, prepared.document);
        true
    }
    pub fn remove(&mut self, id: DocumentId) {
        self.entries.remove(&id);
    }
    pub fn search(&self, query: &str, limit: usize) -> Vec<TextMatch> {
        if query.is_empty() {
            return vec![];
        }
        let query = query.to_lowercase();
        self.entries
            .iter()
            .flat_map(|(id, d)| {
                d.text.lines().enumerate().filter_map(|(line, text)| {
                    text.to_lowercase().contains(&query).then(|| TextMatch {
                        document: *id,
                        line: line + 1,
                        excerpt: text.into(),
                    })
                })
            })
            .take(limit)
            .collect()
    }
    pub fn backlinks(&self, target: DocumentId, catalogue: &Catalogue) -> Vec<DocumentId> {
        self.entries.iter().filter(|(id,entry)|entry.links.iter().any(|link|matches!(catalogue.resolve(**id,link),Resolution::Found { document,.. } if document == target))).map(|(id,_)|*id).collect()
    }
    pub fn load(root: &Path, catalogue: &Catalogue) -> anyhow::Result<Self> {
        let mut index = Self::default();
        for document in catalogue.documents.values() {
            let path = root.join(&document.path);
            let text = match std::fs::read_to_string(path) {
                Ok(t) => t,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
                Err(e) => return Err(e.into()),
            };
            index.update(document.id, 1, text);
        }
        Ok(index)
    }
}

#[cfg(test)]
mod tests;
