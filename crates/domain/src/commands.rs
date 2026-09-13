use crate::*;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    #[error("{0}")]
    Invalid(String),
    #[error("{0} does not exist")]
    Missing(&'static str),
    #[error("{0} already exists")]
    Duplicate(&'static str),
    #[error("Completed encounters are historical snapshots")]
    Completed,
    #[error("Start this encounter before changing health")]
    NotActive,
    #[error("Complete the current encounter before starting another")]
    AlreadyActive,
}
pub type Result<T> = std::result::Result<T, DomainError>;

#[derive(Clone, Debug)]
pub enum Command {
    CreateCreature(Creature),
    UpdateCreature(Creature),
    CreateLocation(Location),
    UpdateLocation(Location),
    CreateSession(Session),
    UpdateSession(Session),
    CreateNote(Note),
    UpdateNote(Note),
    SetRoster(BTreeSet<CreatureId>),
    CreateEncounter {
        id: EncounterId,
        session: SessionId,
        name: String,
        location: Option<LocationId>,
    },
    RenameEncounter {
        id: EncounterId,
        name: String,
    },
    SetLocation {
        encounter: EncounterId,
        location: Option<LocationId>,
    },
    AddCreatures {
        encounter: EncounterId,
        creature: CreatureId,
        quantity: u16,
        initiative: Option<i32>,
    },
    AddLocalCreature {
        encounter: EncounterId,
        creature: Creature,
        quantity: u16,
        initiative: Option<i32>,
    },
    RemoveParticipants {
        encounter: EncounterId,
        participants: BTreeSet<ParticipantId>,
    },
    Start(EncounterId),
    Complete(EncounterId),
    AdjustHealth {
        encounter: EncounterId,
        participants: BTreeSet<ParticipantId>,
        delta: i32,
    },
    ResetHealth {
        encounter: EncounterId,
        participants: BTreeSet<ParticipantId>,
    },
    ResetCharacters(BTreeSet<CreatureId>),
    SetInitiative {
        encounter: EncounterId,
        participants: BTreeSet<ParticipantId>,
        initiative: Option<i32>,
    },
    SetDescription {
        encounter: EncounterId,
        participants: BTreeSet<ParticipantId>,
        description: String,
    },
    RenameParticipant {
        encounter: EncounterId,
        participant: ParticipantId,
        name: String,
    },
    SaveToLibrary {
        encounter: EncounterId,
        participant: ParticipantId,
        id: CreatureId,
    },
}

#[derive(Clone, Debug)]
pub struct Change {
    pub revision: u64,
    pub changed: bool,
    pub added_participants: Vec<ParticipantId>,
}

/// One snapshot per domain command. A bulk mutation is one undo step. Prose has
/// its own Zed transaction history and is deliberately absent from this model.
pub struct CampaignEngine {
    state: Campaign,
    revision: u64,
    undo: Vec<Campaign>,
    redo: Vec<Campaign>,
}
impl CampaignEngine {
    pub fn new(state: Campaign) -> Result<Self> {
        state.validate()?;
        Ok(Self {
            state,
            revision: 0,
            undo: vec![],
            redo: vec![],
        })
    }
    pub fn state(&self) -> &Campaign {
        &self.state
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
    pub fn execute(&mut self, command: Command) -> Result<Change> {
        let mut candidate = self.state.clone();
        let added_participants = candidate.apply(command)?;
        candidate.validate()?;
        let changed = candidate != self.state;
        if changed {
            self.undo
                .push(std::mem::replace(&mut self.state, candidate));
            if self.undo.len() > 100 {
                self.undo.remove(0);
            }
            self.redo.clear();
            self.revision += 1;
        }
        Ok(Change {
            revision: self.revision,
            changed,
            added_participants,
        })
    }
    pub fn undo(&mut self) -> bool {
        let Some(previous) = self.undo.pop() else {
            return false;
        };
        self.redo.push(std::mem::replace(&mut self.state, previous));
        self.revision += 1;
        true
    }
    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo.pop() else {
            return false;
        };
        self.undo.push(std::mem::replace(&mut self.state, next));
        self.revision += 1;
        true
    }
}

fn name(value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(DomainError::Invalid("A name is required".into()))
    } else {
        Ok(())
    }
}
fn creature_valid(c: &Creature) -> Result<()> {
    name(&c.name)?;
    if c.max_hp <= 0 {
        return Err(DomainError::Invalid("Maximum HP must be positive".into()));
    }
    Ok(())
}

impl Campaign {
    pub fn validate(&self) -> Result<()> {
        name(&self.config.name)?;
        if self
            .encounters
            .values()
            .filter(|e| e.status == EncounterStatus::Active)
            .count()
            > 1
        {
            return Err(DomainError::AlreadyActive);
        }
        for (id, c) in &self.creatures {
            creature_valid(c)?;
            if *id != c.id {
                return Err(DomainError::Invalid("Creature ID mismatch".into()));
            }
            if c.kind == CreatureKind::Persistent && !self.character_hp.contains_key(id) {
                return Err(DomainError::Invalid(
                    "Persistent character health is missing".into(),
                ));
            }
        }
        for id in self.character_hp.keys() {
            if !self
                .creatures
                .get(id)
                .is_some_and(|c| c.kind == CreatureKind::Persistent)
            {
                return Err(DomainError::Invalid(
                    "Health state must belong to a persistent character".into(),
                ));
            }
        }
        for id in &self.config.roster {
            if !self.creatures.contains_key(id) {
                return Err(DomainError::Missing("Roster creature"));
            }
        }
        for (id, location) in &self.locations {
            name(&location.name)?;
            if *id != location.id {
                return Err(DomainError::Invalid("Location ID mismatch".into()));
            }
        }
        for (id, session) in &self.sessions {
            name(&session.name)?;
            if *id != session.id {
                return Err(DomainError::Invalid("Session ID mismatch".into()));
            }
        }
        for (id, note) in &self.notes {
            name(&note.name)?;
            if *id != note.id {
                return Err(DomainError::Invalid("Note ID mismatch".into()));
            }
        }
        for (id, e) in &self.encounters {
            name(&e.name)?;
            if *id != e.id {
                return Err(DomainError::Invalid("Encounter ID mismatch".into()));
            }
            if !self.sessions.contains_key(&e.session) {
                return Err(DomainError::Missing("Parent session"));
            }
            if e.location
                .is_some_and(|id| !self.locations.contains_key(&id))
            {
                return Err(DomainError::Missing("Encounter location"));
            }
            let mut persistent = BTreeSet::new();
            for (id, p) in &e.participants {
                name(p.display_name())?;
                if *id != p.id || p.max_hp <= 0 || p.hp > p.max_hp {
                    return Err(DomainError::Invalid("Invalid participant snapshot".into()));
                }
                if let Some(id) = p.creature {
                    if !self.creatures.contains_key(&id) {
                        return Err(DomainError::Missing("Participant creature"));
                    }
                }
                if p.persistent {
                    let id = p
                        .creature
                        .ok_or(DomainError::Missing("Persistent creature"))?;
                    if !persistent.insert(id) {
                        return Err(DomainError::Invalid(
                            "A persistent character can participate only once".into(),
                        ));
                    }
                    if e.status == EncounterStatus::Active
                        && self.character_hp.get(&id) != Some(&p.hp)
                    {
                        return Err(DomainError::Invalid(
                            "Active character health is inconsistent".into(),
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    fn encounter_mut(&mut self, id: EncounterId) -> Result<&mut Encounter> {
        let e = self
            .encounters
            .get_mut(&id)
            .ok_or(DomainError::Missing("Encounter"))?;
        if e.status == EncounterStatus::Completed {
            return Err(DomainError::Completed);
        }
        Ok(e)
    }
    fn targets(
        &mut self,
        encounter: EncounterId,
        ids: &BTreeSet<ParticipantId>,
    ) -> Result<&mut Encounter> {
        let e = self.encounter_mut(encounter)?;
        if ids.is_empty() {
            return Err(DomainError::Invalid(
                "Choose at least one participant".into(),
            ));
        }
        if ids.iter().any(|id| !e.participants.contains_key(id)) {
            return Err(DomainError::Missing("Participant"));
        }
        Ok(e)
    }
    fn sync_health(&mut self, id: EncounterId) {
        if let Some(e) = self.encounters.get(&id) {
            for p in e.participants.values().filter(|p| p.persistent) {
                if let Some(id) = p.creature {
                    self.character_hp.insert(id, p.hp);
                }
            }
        }
    }
    fn add(
        &mut self,
        encounter: EncounterId,
        c: Creature,
        quantity: u16,
        initiative: Option<i32>,
        local: bool,
    ) -> Result<Vec<ParticipantId>> {
        creature_valid(&c)?;
        if quantity == 0 || quantity > 1000 {
            return Err(DomainError::Invalid(
                "Quantity must be between 1 and 1000".into(),
            ));
        }
        let hp = self
            .character_hp
            .get(&c.id)
            .copied()
            .unwrap_or(c.max_hp)
            .min(c.max_hp);
        let e = self.encounter_mut(encounter)?;
        let existing = e
            .participants
            .values()
            .filter(|p| p.creature == Some(c.id))
            .count();
        if !local && c.kind == CreatureKind::Persistent && (quantity != 1 || existing != 0) {
            return Err(DomainError::Invalid(
                "A persistent character can participate only once".into(),
            ));
        }
        let mut added = Vec::new();
        for index in 0..quantity {
            let mut p = Participant::from_creature(&c, initiative);
            if local {
                p.creature = None;
                p.persistent = false;
            }
            if p.persistent {
                p.hp = hp;
            }
            if quantity > 1 || existing > 0 {
                p.local_name = Some(format!("{} {}", c.name, existing + usize::from(index) + 1));
            }
            added.push(p.id);
            e.participants.insert(p.id, p);
        }
        if e.status == EncounterStatus::Active {
            self.sync_health(encounter);
        }
        Ok(added)
    }

    fn apply(&mut self, command: Command) -> Result<Vec<ParticipantId>> {
        use Command::*;
        match command {
            CreateCreature(c) => {
                if self.creatures.contains_key(&c.id) {
                    return Err(DomainError::Duplicate("Creature"));
                }
                if c.kind == CreatureKind::Persistent {
                    self.character_hp.insert(c.id, c.max_hp);
                }
                self.creatures.insert(c.id, c);
            }
            UpdateCreature(c) => {
                let old = self
                    .creatures
                    .get(&c.id)
                    .ok_or(DomainError::Missing("Creature"))?;
                if old.kind != c.kind {
                    return Err(DomainError::Invalid(
                        "Character/template identity cannot be changed".into(),
                    ));
                }
                self.creatures.insert(c.id, c);
            }
            CreateSession(s) => {
                if self.sessions.insert(s.id, s).is_some() {
                    return Err(DomainError::Duplicate("Session"));
                }
            }
            CreateLocation(l) => {
                if self.locations.insert(l.id, l).is_some() {
                    return Err(DomainError::Duplicate("Location"));
                }
            }
            CreateNote(n) => {
                if self.notes.insert(n.id, n).is_some() {
                    return Err(DomainError::Duplicate("Note"));
                }
            }
            UpdateSession(s) => {
                if !self.sessions.contains_key(&s.id) {
                    return Err(DomainError::Missing("Session"));
                }
                self.sessions.insert(s.id, s);
            }
            UpdateLocation(l) => {
                if !self.locations.contains_key(&l.id) {
                    return Err(DomainError::Missing("Location"));
                }
                self.locations.insert(l.id, l);
            }
            UpdateNote(n) => {
                if !self.notes.contains_key(&n.id) {
                    return Err(DomainError::Missing("Note"));
                }
                self.notes.insert(n.id, n);
            }
            SetRoster(roster) => self.config.roster = roster,
            CreateEncounter {
                id,
                session,
                name,
                location,
            } => {
                if self.encounters.contains_key(&id) {
                    return Err(DomainError::Duplicate("Encounter"));
                }
                self.encounters.insert(
                    id,
                    Encounter {
                        id,
                        session,
                        name,
                        aliases: vec![],
                        location,
                        status: EncounterStatus::Planned,
                        participants: Default::default(),
                    },
                );
                let mut added = Vec::new();
                for id_roster in self.config.roster.clone() {
                    let c = self
                        .creatures
                        .get(&id_roster)
                        .ok_or(DomainError::Missing("Roster creature"))?
                        .clone();
                    added.extend(self.add(id, c, 1, None, false)?);
                }
                return Ok(added);
            }
            RenameEncounter { id, name } => self.encounter_mut(id)?.name = name,
            SetLocation {
                encounter,
                location,
            } => self.encounter_mut(encounter)?.location = location,
            AddCreatures {
                encounter,
                creature,
                quantity,
                initiative,
            } => {
                let c = self
                    .creatures
                    .get(&creature)
                    .ok_or(DomainError::Missing("Creature"))?
                    .clone();
                return self.add(encounter, c, quantity, initiative, false);
            }
            AddLocalCreature {
                encounter,
                creature,
                quantity,
                initiative,
            } => return self.add(encounter, creature, quantity, initiative, true),
            RemoveParticipants {
                encounter,
                participants,
            } => {
                let e = self.targets(encounter, &participants)?;
                for id in participants {
                    e.participants.remove(&id);
                }
            }
            Start(id) => {
                if self.active_encounter().is_some() {
                    return Err(DomainError::AlreadyActive);
                }
                let mut e = self
                    .encounters
                    .get(&id)
                    .ok_or(DomainError::Missing("Encounter"))?
                    .clone();
                if e.status == EncounterStatus::Completed {
                    return Err(DomainError::Completed);
                }
                for p in e.participants.values_mut() {
                    if let Some(c) = p.creature.and_then(|id| self.creatures.get(&id)) {
                        p.name = c.name.clone();
                        p.max_hp = c.max_hp;
                        p.ac = c.ac;
                        p.portrait = c.portrait.clone();
                        p.hp = if p.persistent {
                            self.character_hp
                                .get(&c.id)
                                .copied()
                                .unwrap_or(c.max_hp)
                                .min(c.max_hp)
                        } else {
                            c.max_hp
                        };
                    } else {
                        p.hp = p.max_hp;
                    }
                }
                e.status = EncounterStatus::Active;
                self.encounters.insert(id, e);
                self.sync_health(id);
            }
            Complete(id) => {
                let e = self.encounter_mut(id)?;
                if e.status != EncounterStatus::Active {
                    return Err(DomainError::NotActive);
                }
                e.status = EncounterStatus::Completed;
            }
            AdjustHealth {
                encounter,
                participants,
                delta,
            } => {
                let e = self.targets(encounter, &participants)?;
                if e.status != EncounterStatus::Active {
                    return Err(DomainError::NotActive);
                }
                for id in participants {
                    let p = e.participants.get_mut(&id).unwrap();
                    p.hp = p.hp.saturating_add(delta).min(p.max_hp);
                }
                self.sync_health(encounter);
            }
            ResetHealth {
                encounter,
                participants,
            } => {
                let e = self.targets(encounter, &participants)?;
                if e.status != EncounterStatus::Active {
                    return Err(DomainError::NotActive);
                }
                for id in participants {
                    let p = e.participants.get_mut(&id).unwrap();
                    p.hp = p.max_hp;
                }
                self.sync_health(encounter);
            }
            ResetCharacters(ids) => {
                if ids.is_empty() {
                    return Err(DomainError::Invalid("Choose at least one character".into()));
                }
                for id in ids {
                    let c = self
                        .creatures
                        .get(&id)
                        .ok_or(DomainError::Missing("Character"))?;
                    if c.kind != CreatureKind::Persistent {
                        return Err(DomainError::Invalid(
                            "Only persistent characters carry health".into(),
                        ));
                    }
                    let mut hp = c.max_hp;
                    for e in self
                        .encounters
                        .values_mut()
                        .filter(|e| e.status == EncounterStatus::Active)
                    {
                        for p in e
                            .participants
                            .values_mut()
                            .filter(|p| p.creature == Some(id) && p.persistent)
                        {
                            p.hp = p.max_hp;
                            hp = p.hp;
                        }
                    }
                    self.character_hp.insert(id, hp);
                }
            }
            SetInitiative {
                encounter,
                participants,
                initiative,
            } => {
                let e = self.targets(encounter, &participants)?;
                for id in &participants {
                    e.participants.get_mut(id).unwrap().initiative = initiative;
                }
            }
            SetDescription {
                encounter,
                participants,
                description,
            } => {
                let e = self.targets(encounter, &participants)?;
                for id in participants {
                    e.participants.get_mut(&id).unwrap().description = description.clone();
                }
            }
            RenameParticipant {
                encounter,
                participant,
                name: new_name,
            } => {
                name(&new_name)?;
                let e = self.targets(encounter, &[participant].into_iter().collect())?;
                e.participants.get_mut(&participant).unwrap().local_name = Some(new_name);
            }
            SaveToLibrary {
                encounter,
                participant,
                id,
            } => {
                if self.creatures.contains_key(&id) {
                    return Err(DomainError::Duplicate("Creature"));
                }
                let p = self
                    .encounter_mut(encounter)?
                    .participants
                    .get_mut(&participant)
                    .ok_or(DomainError::Missing("Participant"))?;
                if p.creature.is_some() {
                    return Err(DomainError::Invalid(
                        "This participant is already in the library".into(),
                    ));
                }
                let c = Creature {
                    id,
                    name: p.display_name().to_owned(),
                    aliases: vec![],
                    max_hp: p.max_hp,
                    ac: p.ac,
                    kind: CreatureKind::Template,
                    portrait: p.portrait.clone(),
                };
                p.creature = Some(id);
                self.creatures.insert(id, c);
            }
        }
        Ok(vec![])
    }
}
