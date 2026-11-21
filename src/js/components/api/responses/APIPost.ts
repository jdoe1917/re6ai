import { APIResponse } from "./APIResponse";

export interface APIPost extends APIResponse {
  id: number;
  created_at: string;
  updated_at: string;
  file: File;
  preview: Preview;
  sample: Sample;
  score: Score;
  tags: APIPostTags;
  locked_tags: string[];
  change_seq: number;
  flags: Flags;
  rating: PostRating;
  fav_count: number;
  sources: string[];
  pools: number[];
  relationships: Relationships;
  approver_id?: number;
  uploader_id: number;
  description: string;
  comment_count: number;
  is_favorited?: boolean;
  duration: number;

  /** Set by `APIPost.normalize()`. False if the site returned a flat tag list, with no categories. */
  tagCategoriesKnown?: boolean;
}

interface Relationships {
  parent_id?: number;
  has_children: boolean;
  has_active_children: boolean;
  children: number[];
}

interface Flags {
  pending: boolean;
  flagged: boolean;
  note_locked: boolean;
  status_locked: boolean;
  rating_locked: boolean;
  deleted: boolean;
}

export interface APIPostTags {
  general: string[];
  species: string[];
  character: string[];
  franchise: string[];
  director: string[];
  invalid: string[];
  meta: string[];
  lore: string[];
}

interface Score {
  up: number;
  down: number;
  total: number;
}

interface Sample {
  has: boolean;
  height: number;
  width: number;
  url: string;
}

interface Preview {
  width: number;
  height: number;
  url: string;
}

interface File {
  width: number;
  height: number;
  ext: string;
  size: number;
  md5: string;
  url: string;
}

export enum PostRating {
  Safe = "s",
  Questionable = "q",
  Explicit = "e",
}

enum PostRatingAliases {
  "s" = PostRating.Safe,
  "safe" = PostRating.Safe,
  "q" = PostRating.Questionable,
  "questionable" = PostRating.Questionable,
  "e" = PostRating.Explicit,
  "explicit" = PostRating.Explicit,
}

export enum PostFlag {
  /** Post in the modqueue that has not been approved / disapproved yet */
  Pending = "pending",
  /** Post that has been flagged for moderation - duplicate, DNP, etc */
  Flagged = "flagged",
  /** Post that has been deleted. Indicates that the image file will return `null` */
  Deleted = "deleted",

  // Not working correctly
  // NoteLocked = "note_locked",
  // StatusLocked = "status_locked",
  // RatingLocked = "rating_locked",
}

export namespace PostFlag {

  export function get (post: APIPost): Set<PostFlag> {
    const flags: Set<PostFlag> = new Set();
    if (post.flags.deleted) flags.add(PostFlag.Deleted);
    if (post.flags.flagged) flags.add(PostFlag.Flagged);
    if (post.flags.pending) flags.add(PostFlag.Pending);
    return flags;
  }

  export function getString (post: APIPost): string {
    return [...PostFlag.get(post)].join(" ");
  }

  export function fromSingle (input: string): PostFlag {
    input = input.toLowerCase().trim();
    switch (input) {
      case "pending": return PostFlag.Pending;
      case "flagged": return PostFlag.Flagged;
      case "deleted": return PostFlag.Deleted;
    }
    return null;
  }

  export function fromString (input: string): Set<PostFlag> {
    const parts = new Set(input.split(" "));
    const flags: Set<PostFlag> = new Set();
    if (parts.has("deleted")) flags.add(PostFlag.Deleted);
    if (parts.has("flagged")) flags.add(PostFlag.Flagged);
    if (parts.has("pending")) flags.add(PostFlag.Pending);
    return flags;
  }

}

export namespace PostRating {
  export function fromValue (value: string): PostRating {
    return PostRatingAliases[value];
  }

  export function toString (postRating: PostRating): string {
    for (const key of Object.keys(PostRating)) {
      if (PostRating[key] === postRating) {
        return key;
      }
    }
    return undefined;
  }

  export function toFullString (postRating: PostRating): string {
    switch (postRating.toLowerCase()) {
      case "s": return "safe";
      case "q": return "questionable";
      case "e": return "explicit";
    }
    return null;
  }
}

export namespace APIPost {

  /**
   * Converts the tags returned by the site into the categories used by the script.
   * Supported sites name their categories differently (artist / copyright / contributor),
   * and some endpoints return a flat list of tags with no categories at all.
   * @returns Categorized tags, and whether the categories are actually known
   */
  export function normalizeTags (tags: unknown): { tags: APIPostTags; categoriesKnown: boolean } {
    if (Array.isArray(tags)) {
      return {
        tags: { general: tags, species: [], character: [], franchise: [], director: [], invalid: [], meta: [], lore: [] },
        categoriesKnown: false,
      };
    }

    const source = (tags || {}) as Record<string, unknown>;
    const get = (...keys: string[]): string[] => keys.flatMap((key) => (Array.isArray(source[key]) ? source[key] as string[] : []));
    return {
      tags: {
        director: get("director", "artist", "contributor"),
        franchise: get("franchise", "copyright"),
        character: get("character"),
        general: get("general"),
        species: get("species"),
        invalid: get("invalid"),
        meta: get("meta"),
        lore: get("lore"),
      },
      categoriesKnown: true,
    };
  }

  /**
   * Converts a post returned by any of the supported sites into the structure used by the script.
   * Handles both the legacy structure (`file`, `sample`, `score`) and the new one (`files`, `stats`, `has`).
   * Anything that doesn't look like a post is returned as-is.
   */
  export function normalize (raw: any): APIPost {
    if (!raw || typeof raw !== "object" || raw.id === undefined || raw.tags === undefined) return raw;

    const { tags, categoriesKnown } = normalizeTags(raw.tags);
    const result = { ...raw, tags: tags, tagCategoriesKnown: categoriesKnown } as APIPost;

    if (raw.files) {
      const files = raw.files, has = raw.has || {}, stats = raw.stats || {}, rel = raw.relationships || {};
      const original = files.original || {}, meta = files.meta || {}, preview = files.preview || {}, sample = files.sample || {};

      result.file = { width: original.width, height: original.height, ext: meta.ext, size: meta.size, md5: meta.md5, url: original.url };
      result.preview = { width: preview.width, height: preview.height, url: preview.jpg };
      result.sample = { has: meta.has_sample === true || has.sample === true, width: sample.width, height: sample.height, url: sample.jpg };
      result.score = stats.score;
      result.fav_count = stats.fav_count;
      result.comment_count = stats.comment_count;
      result.is_favorited = stats.is_favorited;
      result.duration = meta.duration;
      result.relationships = {
        parent_id: rel.parent_id,
        has_children: has.children === true,
        has_active_children: has.active_children === true,
        children: rel.children || [],
      };
      result["user_score"] = stats.vote;
    } else if (result["user_score"] === undefined && typeof raw.vote === "number") {
      result["user_score"] = raw.vote;
    }

    return result;
  }

  export function getTags (post: APIPost): string[] {
    return [
      ...post.tags.director,
      ...post.tags.franchise,
      ...post.tags.character,
      ...post.tags.general,
      ...post.tags.invalid,
      ...post.tags.meta,
      ...post.tags.species,
      ...post.tags.lore,
    ];
  }

  export function getTagString (post: APIPost): string {
    return APIPost.getTags(post).join(" ");
  }

  export function getTagSet (post: APIPost): Set<string> {
    return new Set(APIPost.getTags(post));
  }

}
