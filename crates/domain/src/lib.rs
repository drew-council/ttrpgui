//! Portable campaign entities and undoable rules. This crate has no UI or I/O.
mod commands;
mod model;

pub use commands::*;
pub use model::*;
