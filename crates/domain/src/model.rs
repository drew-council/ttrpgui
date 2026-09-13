use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BTreeSet},
    fmt,
    str::FromStr,
};
use uuid::Uuid;

macro_rules! ids {
    ($($name:ident),+) => {$ (
        #[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub Uuid);
        impl $name { pub fn new() -> Self { Self(Uuid::new_v4()) } }
        impl Default for $name { fn default() -> Self { Self::new() } }
        impl fmt::Display for $name { fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { self.0.fmt(f) } }
        impl FromStr for $name { type Err = uuid::Error; fn from_str(s: &str) -> Result<Self, Self::Err> { Uuid::parse_str(s).map(Self) } }
    )+};
}
ids!(
    CampaignId,
    CreatureId,
    LocationId,
    SessionId,
    EncounterId,
    ParticipantId,
    NoteId
);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreatureKind {
    Persistent,
    Template,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Creature {
    pub id: CreatureId,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub max_hp: i32,
    pub ac: Option<i32>,
    pub kind: CreatureKind,
    pub portrait: Option<String>,
}
impl Creature {
    pub fn new(name: impl Into<String>, max_hp: i32, ac: Option<i32>, kind: CreatureKind) -> Self {
        Self {
            id: CreatureId::new(),
            name: name.into(),
            aliases: vec![],
            max_hp,
            ac,
            kind,
            portrait: None,
        }
    }
}

macro_rules! page {
    ($name:ident, $id:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
        pub struct $name {
            pub id: $id,
            pub name: String,
            #[serde(default)]
            pub aliases: Vec<String>,
            pub portrait: Option<String>,
        }
        impl $name {
            pub fn new(name: impl Into<String>) -> Self {
                Self {
                    id: $id::new(),
                    name: name.into(),
                    aliases: vec![],
                    portrait: None,
                }
            }
        }
    };
}
page!(Session, SessionId);
page!(Location, LocationId);
page!(Note, NoteId);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncounterStatus {
    Planned,
    Active,
    Completed,
}

/// Values captured for this encounter, unaffected by later library changes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Participant {
    pub id: ParticipantId,
    pub creature: Option<CreatureId>,
    pub persistent: bool,
    pub name: String,
    pub max_hp: i32,
    pub hp: i32,
    pub ac: Option<i32>,
    pub initiative: Option<i32>,
    pub local_name: Option<String>,
    #[serde(default)]
    pub description: String,
    pub portrait: Option<String>,
}
impl Participant {
    pub fn display_name(&self) -> &str {
        self.local_name.as_deref().unwrap_or(&self.name)
    }
    pub fn from_creature(creature: &Creature, initiative: Option<i32>) -> Self {
        Self {
            id: ParticipantId::new(),
            creature: Some(creature.id),
            persistent: creature.kind == CreatureKind::Persistent,
            name: creature.name.clone(),
            max_hp: creature.max_hp,
            hp: creature.max_hp,
            ac: creature.ac,
            initiative,
            local_name: None,
            description: String::new(),
            portrait: creature.portrait.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Encounter {
    pub id: EncounterId,
    pub session: SessionId,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub location: Option<LocationId>,
    pub status: EncounterStatus,
    #[serde(default)]
    pub participants: BTreeMap<ParticipantId, Participant>,
}
impl Encounter {
    pub fn sorted_participants(&self) -> Vec<&Participant> {
        let mut rows: Vec<_> = self.participants.values().collect();
        rows.sort_by_cached_key(|row| {
            (
                row.initiative.is_none(),
                Reverse(row.initiative.unwrap_or(i32::MIN)),
                row.display_name().to_lowercase(),
                row.id,
            )
        });
        rows
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CampaignConfig {
    pub id: CampaignId,
    pub name: String,
    #[serde(default)]
    pub roster: BTreeSet<CreatureId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Campaign {
    pub config: CampaignConfig,
    #[serde(default)]
    pub creatures: BTreeMap<CreatureId, Creature>,
    #[serde(default)]
    pub character_hp: BTreeMap<CreatureId, i32>,
    #[serde(default)]
    pub locations: BTreeMap<LocationId, Location>,
    #[serde(default)]
    pub sessions: BTreeMap<SessionId, Session>,
    #[serde(default)]
    pub encounters: BTreeMap<EncounterId, Encounter>,
    #[serde(default)]
    pub notes: BTreeMap<NoteId, Note>,
}
impl Campaign {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            config: CampaignConfig {
                id: CampaignId::new(),
                name: name.into(),
                roster: BTreeSet::new(),
            },
            creatures: BTreeMap::new(),
            character_hp: BTreeMap::new(),
            locations: BTreeMap::new(),
            sessions: BTreeMap::new(),
            encounters: BTreeMap::new(),
            notes: BTreeMap::new(),
        }
    }
    pub fn active_encounter(&self) -> Option<&Encounter> {
        self.encounters
            .values()
            .find(|e| e.status == EncounterStatus::Active)
    }
}
