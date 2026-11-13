// On-disk formats. Every object is strict: unknown keys are violations.
import { z } from "zod";
import { defaultKeys, normalizeKey } from "./keys.ts";

const int = z.int();
const text = z.string();

export const imageRoles = ["main", "map", "landscape"] as const;
export type ImageRole = (typeof imageRoles)[number];

/** Hit point state. Absent `current` means full. */
const Hp = z.strictObject({
	current: int.optional(),
	temp: int.optional(),
	max_adjust: int.optional(),
});
export type Hp = z.infer<typeof Hp>;

const shared = {
	/** Image file name to role. Unlisted images have no role. */
	images: z.record(z.string(), z.enum(imageRoles)).optional(),
};

/** `notes/<Title>/metadata.toml`. The file is optional; absent means a plain note. */
export const Metadata = z.discriminatedUnion(
	"kind",
	[
		z.strictObject({ kind: z.undefined().optional(), ...shared }),
		z.strictObject({
			kind: z.literal("session"),
			// TOML local dates (`date = 2026-11-07`) and strings both work.
			date: z
				.preprocess(
					(v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
					z.iso.date({ error: "expected a date like 2026-11-07" }),
				)
				.optional(),
			...shared,
		}),
		z.strictObject({
			kind: z.literal("creature"),
			/** Absent means NPC. */
			pc: z.boolean().optional(),
			/** What players see. Defaults to the title. */
			display_name: text.optional(),
			/** PC state carried between combats. */
			hp: Hp.optional(),
			...shared,
		}),
		z.strictObject({ kind: z.literal("location"), ...shared }),
	],
	{ error: 'must be "session", "creature", or "location"' },
);
export type Metadata = z.infer<typeof Metadata>;
export type Kind = NonNullable<Metadata["kind"]>;

const abilityMap = z.strictObject({
	str: int.optional(),
	dex: int.optional(),
	con: int.optional(),
	int: int.optional(),
	wis: int.optional(),
	cha: int.optional(),
});

/** `notes/<Title>/statblock.toml`. Every field is optional. */
export const Statblock = z.strictObject({
	ac: int.optional(),
	hp: int.optional(),
	speed: text.optional(),
	abilities: abilityMap.optional(),
	saves: abilityMap.optional(),
	/** Skill name to bonus, e.g. `stealth = 6`. */
	skills: z.record(z.string(), int).optional(),
	vulnerabilities: text.optional(),
	resistances: text.optional(),
	immunities: text.optional(),
	senses: text.optional(),
	languages: text.optional(),
	cr: z.union([z.number(), text]).optional(),
	initiative: int.optional(),
	legendary_actions: int.optional(),
	legendary_resistances: int.optional(),
	/** Ordered, freely named sections such as "Traits", "Actions", or "Spellcasting". */
	sections: z
		.array(
			z.strictObject({
				name: text,
				entries: z.array(z.strictObject({ name: text, text })),
			}),
		)
		.optional(),
});
export type Statblock = z.infer<typeof Statblock>;

/** One entry in a Combat, keyed by its label. Base max HP and AC come from the creature's stat block. */
const Combatant = z.strictObject({
	/** Title of a Creature note. */
	creature: text,
	initiative: int.optional(),
	/** NPCs only: a PC's HP lives in its metadata.toml. */
	hp: Hp.optional(),
	/** Condition name to rounds left, or `true` for no limit. */
	conditions: z
		.record(
			z.string(),
			z.union([z.literal(true), int], {
				error: "expected a number of rounds, or true",
			}),
		)
		.optional(),
	concentrating: z.boolean().optional(),
	death_saves: z
		.strictObject({ success: int.optional(), failure: int.optional() })
		.optional(),
	/** Uses left. Absent means the stat block's full count. */
	legendary_actions: int.optional(),
	legendary_resistances: int.optional(),
	/** Has had a turn since the Combat started. */
	acted: z.boolean().optional(),
	note: text.optional(),
});
export type Combatant = z.infer<typeof Combatant>;

/** `combats/<Name>.toml`. */
export const Combat = z.strictObject({
	/** Title of the Session note it belongs to. */
	session: text.optional(),
	/** Set while the Combat runs. */
	round: int.optional(),
	/** Label of the active Combatant. */
	turn: text.optional(),
	/** Name of the Atmosphere that Start switches to. */
	atmosphere: text.optional(),
	combatants: z.record(z.string(), Combatant).optional(),
});
export type Combat = z.infer<typeof Combat>;

/** `runtime.toml`: shared table state, so a restart picks up where it left off. */
export const Runtime = z.strictObject({
	/** Title of the live Session note. */
	session: text.optional(),
	/** Name of the running Combat. */
	combat: text.optional(),
	/** Name of the Atmosphere chosen with "Switch atmosphere". Absent means the default. */
	atmosphere: text.optional(),
	/** The Atmosphere to switch back to when the running Combat ends. */
	restore_atmosphere: text.optional(),
	/** The image on the display, as `<Note title>/<file>`. */
	image: text.optional(),
	music: z
		.strictObject({
			/** File name in the active Atmosphere's `music/`. */
			track: text.optional(),
			paused: z.boolean().optional(),
			/** Percent. Absent means 100. */
			volume: int.min(0).max(100).optional(),
		})
		.optional(),
});
export type Runtime = z.infer<typeof Runtime>;

/** `atmospheres/<Name>/atmosphere.toml`. The file is optional. Playback only uses the files beside it. */
export const AtmosphereSettings = z.strictObject({
	/** The Game's default Atmosphere. At most one has it; without one, the first by name is. */
	default: z.boolean().optional(),
	/** Link to download as `wallpaper.<ext>`, such as a YouTube video. */
	wallpaper: z.url().optional(),
	/** The part of the wallpaper link to download. Absent means the first two minutes. */
	wallpaper_section: z
		.string()
		.regex(/^\d+(:\d\d){0,2}-\d+(:\d\d){0,2}$/, {
			error: 'expected a time range like "1:00:00-1:02:00"',
		})
		.optional(),
	/** Link to download into `music/`, such as a YouTube Music playlist. */
	music: z.url().optional(),
});
export type AtmosphereSettings = z.infer<typeof AtmosphereSettings>;

/** `$XDG_CONFIG_HOME/ttrpgui/config.toml`: user settings shared by every Game. */
export const Config = z.strictObject({
	/** Action id to bind, overriding the default. "" unbinds. */
	keys: z
		.record(
			z.string().refine((id) => Object.hasOwn(defaultKeys, id)),
			z.string().refine((k) => k === "" || normalizeKey(k), {
				error: 'expected a key like "ctrl+k" or "shift+g", or "" to unbind',
			}),
			{ error: "unknown action" },
		)
		.optional(),
	/** Extra `yt-dlp` arguments for every sync, such as `["--cookies-from-browser", "firefox"]`. */
	ytdlp_args: z.array(z.string()).optional(),
});
export type Config = z.infer<typeof Config>;
