import { E621 } from "../api/E621";
import { APITag, TagCategory } from "../api/responses/APITag";
import { XM } from "../api/XM";
import { TagCache } from "./TagCache";

/**
 * Determines which artists of a post are in the user's tag tracker subscriptions.
 *
 * Reads the subscription list straight from storage, instead of going through the TagTracker module,
 * since the latter is a heavy dependency that would make a circular import out of the post components.
 */
export class TrackedArtists {

  /** Same entry that is used by the TagTracker's `SubscriptionList` */
  private static readonly storageTag = "re621.TagTracker.list";

  private static tracked: Set<string> = new Set();

  private static loading: Promise<void>;

  /** Category lookups that are in progress. Makes sure that every tag is only requested once */
  private static lookups = new Map<string, Promise<TagCategory>>();

  /** Loads the subscriptions, and keeps them up to date if they change in another tab */
  private static load (): Promise<void> {
    if (!TrackedArtists.loading) {
      TrackedArtists.loading = TrackedArtists.refresh().then(() => {
        XM.Storage.addListener(TrackedArtists.storageTag, () => { TrackedArtists.refresh(); });
      });
    }
    return TrackedArtists.loading;
  }

  private static async refresh (): Promise<void> {
    const data = await XM.Storage.getValue(TrackedArtists.storageTag, []);
    const list: unknown[] = Array.isArray(data) ? data : Object.values(data || {});

    // The list has a marker entry at the end, see `SubscriptionList.pushSubscriptions()`
    TrackedArtists.tracked = new Set(
      list.filter((entry): entry is string => typeof entry === "string" && !entry.startsWith("re621:")),
    );
  }

  /** Returns the category of the tag, looking it up if it is not cached */
  private static getCategory (tag: string): Promise<TagCategory> {
    const cached = TagCache.get(tag);
    if (cached) return Promise.resolve(cached.category);

    if (!TrackedArtists.lookups.has(tag)) {
      TrackedArtists.lookups.set(tag, E621.Tag.id(encodeURIComponent(tag)).first<APITag>().then(
        (data) => {
          if (!data) return TagCategory.Unknown;
          TagCache.add(tag, data.post_count, data.category);
          TagCache.save();
          return data.category;
        },
        () => {
          // Do not remember failures, so that the next page load can try again
          TrackedArtists.lookups.delete(tag);
          return TagCategory.Unknown;
        },
      ));
    }
    return TrackedArtists.lookups.get(tag);
  }

  /**
   * Returns the artists of the post that the user is subscribed to
   * @param post Post to check
   * @returns Names of the tracked artists. Empty if there are none.
   */
  public static async find (post: { tags: { all: Set<string>; real_director: Set<string> }; tagCategoriesKnown: boolean }): Promise<string[]> {
    await TrackedArtists.load();
    if (TrackedArtists.tracked.size == 0) return [];

    // Tag categories are known, so there is no need to ask the site
    if (post.tagCategoriesKnown)
      return [...post.tags.real_director].filter(tag => TrackedArtists.tracked.has(tag));

    // Some sites only return a flat list of tags. Only the tracked ones need to be looked up,
    // and since there aren't many of those on any given post, this is cheap.
    const result: string[] = [];
    for (const tag of post.tags.all) {
      if (!TrackedArtists.tracked.has(tag)) continue;
      if (await TrackedArtists.getCategory(tag) == TagCategory.Director) result.push(tag);
    }
    return result;
  }

}
