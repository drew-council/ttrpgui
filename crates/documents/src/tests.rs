use super::*;

fn sample() -> (Campaign, DocumentId, DocumentId) {
    let mut campaign = Campaign::new("Campaign");
    let a = Note::new("A");
    let b = Location::new("Flooded Archive");
    let from = DocumentId::Note(a.id);
    let to = DocumentId::Location(b.id);
    campaign.notes.insert(a.id, a);
    campaign.locations.insert(b.id, b);
    (campaign, from, to)
}

#[test]
fn portable_links_headings_aliases_and_ambiguity() {
    let (mut campaign, from, to) = sample();
    campaign
        .locations
        .values_mut()
        .next()
        .unwrap()
        .aliases
        .push("Archive".into());
    let catalogue = Catalogue::from_campaign(&campaign);
    let generated = catalogue.relative_link(from, to, Some("Room 2")).unwrap();
    let links = parse_links(&generated);
    assert!(
        matches!(catalogue.resolve(from,&links[0]),Resolution::Found { document,.. } if document==to)
    );
    let wiki = parse_links("[[Archive#Room 2|enter]]");
    assert_eq!(wiki[0].label.as_deref(), Some("enter"));
    assert_eq!(
        catalogue.resolve(from, &wiki[0]),
        Resolution::Found {
            document: to,
            heading: Some("Room 2".into())
        }
    );
    let duplicate = Note::new("Archive");
    campaign.notes.insert(duplicate.id, duplicate);
    assert!(
        matches!(Catalogue::from_campaign(&campaign).resolve(from,&wiki[0]),Resolution::Ambiguous(ids) if ids.len()==2)
    );
}

#[test]
fn code_and_unknown_markdown_are_preserved_during_rename() {
    let (mut campaign, from, _) = sample();
    let before = Catalogue::from_campaign(&campaign);
    campaign.locations.values_mut().next().unwrap().name = "New archive".into();
    let after = Catalogue::from_campaign(&campaign);
    let mut source="[[Flooded Archive#Room|label]]\n`[[Flooded Archive]]`\n```\n[[Flooded Archive]]\n```\n<custom />".to_owned();
    let edits = links_after_change(&source, from, &before, &after);
    assert_eq!(edits.len(), 1);
    for edit in edits {
        source.replace_range(edit.range, &edit.replacement);
    }
    assert!(source.starts_with("[[New archive#Room|label]]"));
    assert!(source.contains("`[[Flooded Archive]]`"));
    assert!(source.ends_with("<custom />"));
}

#[test]
fn index_discards_stale_work_and_tracks_backlinks() {
    let (campaign, from, to) = sample();
    let catalogue = Catalogue::from_campaign(&campaign);
    let mut index = SearchIndex::default();
    assert!(index.update(from, 2, "Visit [[Flooded Archive]].\nÉowyn waits".into()));
    assert!(!index.update(from, 1, "obsolete".into()));
    assert_eq!(index.backlinks(to, &catalogue), vec![from]);
    assert_eq!(index.search("éowyn", 10)[0].line, 2);
    assert_eq!(catalogue.search("fldarc", 10)[0].id, to);
}

#[test]
fn relative_links_rewrite_when_document_moves() {
    let (campaign, from, to) = sample();
    let before = Catalogue::from_campaign(&campaign);
    let source = before.relative_link(from, to, None).unwrap();
    let mut after = Catalogue::from_campaign(&campaign);
    after.documents.get_mut(&to).unwrap().path = "locations/moved/notes.md".into();
    let mut changed = source.clone();
    for edit in links_after_change(&source, from, &before, &after) {
        changed.replace_range(edit.range, &edit.replacement);
    }
    assert!(
        matches!(after.resolve(from,&parse_links(&changed)[0]),Resolution::Found { document,.. } if document==to)
    );
}

#[test]
fn ten_thousand_page_warm_search_measurement() {
    let mut campaign = Campaign::new("Large campaign");
    for number in 0..10_000 {
        let note = Note::new(format!("Location {number:05}"));
        campaign.notes.insert(note.id, note);
    }
    let catalogue = Catalogue::from_campaign(&campaign);
    catalogue.search("loc 099", 20);
    let start = std::time::Instant::now();
    let results = catalogue.search("loc 099", 20);
    let elapsed = start.elapsed();
    assert!(!results.is_empty());
    eprintln!("10,000 page warm fuzzy query: {elapsed:?}");
    // Report actual timing instead of a machine-dependent CI assertion.
}
