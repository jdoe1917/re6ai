import { E621 } from "../../components/api/E621";
import { APIPost, PostFlag } from "../../components/api/responses/APIPost";
import { XM } from "../../components/api/XM";
import { Blacklist } from "../../components/data/Blacklist";
import { Page, PageDefinition } from "../../components/data/Page";
import { ModuleController } from "../../components/ModuleController";
import { PostData } from "../../components/post/Post";
import { PostActions } from "../../components/post/PostActions";
import { PostParts } from "../../components/post/PostParts";
import { Settings } from "../../components/RE6Module";
import { Icons } from "../../components/utility/Icons";
import { Util } from "../../components/utility/Util";
import { WikiEnhancer } from "../misc/WikiEnhancer";
import { BetterSearch, ImageClickAction } from "../search/BetterSearch";
import { UpdateContent, UpdateData } from "./_SubscriptionCache";
import { SubscriptionManager } from "./_SubscriptionManager";
import { SubscriptionTracker } from "./_SubscriptionTracker";

export class TagTracker extends SubscriptionTracker {

  // Needs to be overridden due to lower lookup batch sizes
  protected batchSize = 40;

  protected quickSubEnabled = true;

  protected buttonSelect = {
    minor: {
      regex: [PageDefinition.search, PageDefinition.post],
      selector: "#tag-box li span.tag-list-subscribe, #tag-list li span.tag-list-subscribe",
    },
    major: {
      regex: [PageDefinition.wiki, PageDefinition.wikiNA, PageDefinition.artist],
      selector: "#c-wiki-pages > #a-show > #content > h1:first, #c-artists > #a-show > h1:first",
    },
  };

  public getDefaultSettings (): Settings {
    return {
      ...super.getDefaultSettings(),

      cacheSize: 500,                 // how many subscription updates are kept

      hideFavorited: false,           // hide updates for posts that the user has already favorited
      blacklistShown: [],             // blacklist filters that the user unchecked, i.e. whose posts are shown
    };
  }

  protected fetchMinorSubscriptionName (element: JQuery<HTMLElement>): string {
    return decodeURIComponent(element.attr("data-tag"));
  }

  protected fetchMajorSubscriptionName (element: JQuery<HTMLElement>): string {
    return WikiEnhancer.sanitizeWikiTagName(element.find("a:first").text());
  }

  public async fetchUpdatedEntries (): Promise<UpdateData> {

    const result: UpdateData = {};
    this.clearStatus();
    this.writeStatus("Updating Tag Subscriptions");

    // Fetching the list of subscriptions
    this.writeStatus(`. . . retrieving settings`);
    const subscriptions = this.slist.get();
    const lastUpdate = await this.fetchSettings<number>("lastUpdate", true);
    if (subscriptions.size == 0) return result;

    // Splitting subscriptions into batches and sending API requests
    this.writeStatus(`. . . sending an API request`);
    const subscriptionsChunks = Util.chunkArray(subscriptions, this.batchSize);
    const apiResponse: { [timestamp: number]: APIPost } = {};

    for (const [index, chunk] of subscriptionsChunks.entries()) {

      // Processing batch #index
      const processedChunk = chunk.map(el => "~" + el);
      if (index == 10) this.writeStatus(`&nbsp; &nbsp; &nbsp; <span style="color:gold">connection throttled</span>`);
      if (subscriptionsChunks.length > 1)
        this.writeStatus(`&nbsp; &nbsp; - processing batch #${index} [<a href="/posts?tags=${processedChunk.join("+")}" target="_blank">${chunk.length}</a>]`);

      for (const post of await E621.Posts.get<APIPost>({ "tags": processedChunk, "limit": 320 }, index < 10 ? 500 : 1000))
        apiResponse[new Date(post.created_at).getTime()] = post;

      // This should prevent the tracker from double-updating if the process takes more than 5 minutes
      // There are definitely users who are subscribed to enough tags to warrant this
      SubscriptionManager.trigger("inprogress." + this.trackerID, 1);
    }

    // Parsing output, discarding irrelevant data
    this.writeStatus(`. . . formatting output`);
    // await Util.sleep(5000);
    for (const index of Object.keys(apiResponse).sort()) {

      // This is needed exclusively for the Blacklist below
      const post = PostData.fromAPI(apiResponse[index]);

      // Don't include updates posted before the last update timestamp
      const timestamp = post.date.obj.getTime();
      if (timestamp < lastUpdate) continue;

      // Posts with blacklisted tags are kept, along with the filters that matched them.
      // Whether they are displayed is decided on the notifications page, see `applyFilters()`
      Blacklist.addPost(post);
      const matchedFilters = Blacklist.getMatchingFilters(post);

      result[timestamp] = {
        uid: post.id,
        md5:
                    ((post.file.ext == "swf" || post.flags.has(PostFlag.Deleted)) ? "" : post.file.md5)
                    + "|" + post.has.sample     // sample       boolean
                    + "|" + post.file.ext       // extension    string
                    + "|" + post.rating         // rating       E | Q | S
                    + "|" + post.img.width      // width        int
                    + "|" + post.img.height     // height       int
                    + "|" + post.file.size,      // filesize     int
        new: true,
        fav: post.is_favorited,
        ...(matchedFilters.length > 0 ? { bl: matchedFilters } : {}),
      };
    }

    this.writeStatus(`. . . displaying results`);

    return result;
  }

  protected drawUpdateEntry (data: UpdateContent, timestamp: number, deleteFunction): JQuery<HTMLElement> {

    if (!data.md5) {
      console.error("Error: Invalid data in cache");
      return;
    }

    const imageData = data.md5.split("|");
    const result = $("<subitem>")
      .attr({
        "new": data.new,    // Output ordering
        "fav": data.fav === true,
        "uid": timestamp,   // Needed for dynamic rendering

        // Necessary data for the HoverZoom
        "data-id": data.uid,
        "data-md5": imageData[0],
        "data-preview-url": getPreviewLink(imageData[0]),
        "data-sample-url": getSampleLink(imageData[0], imageData[1] == "true", imageData[2]),
        "data-file-ext": imageData[2],
        "data-rating": imageData[3] || "e",
        "data-created-at": new Date(timestamp).toString(),

        "data-width": imageData[4],
        "data-height": imageData[5],
        "data-size": imageData[6],

        "hztrigger": "img",
      })
      .on("re621:render", () => {
        const link = $("<a>")
          .attr({ href: "/posts/" + data.uid })
          .appendTo(result);

        PostParts.bootstrapDoubleClick(link, () => {

          switch (ModuleController.fetchSettings(BetterSearch, "clickAction")) {
            case ImageClickAction.NewTab: {
              XM.Util.openInTab(window.location.origin + link.attr("href"), false);
              break;
            }
            case ImageClickAction.CopyID: {
              XM.Util.setClipboard(data.uid + "", "text");
              Danbooru.notice(`Copied post ID to clipboard: <a href="/posts/${data.uid}" target="_blank" rel="noopener noreferrer">#${data.uid}</a>`);
              break;
            }
            case ImageClickAction.Blacklist: {
              Blacklist.toggleBlacklistTag("id:" + data.uid);
              break;
            }
            case ImageClickAction.AddToSet: {
              const lastSet = parseInt(window.localStorage.getItem("set"));
              if (!lastSet) Danbooru.error(`Error: no set selected`);
              else PostActions.addSet(lastSet, data.uid);
              break;
            }
            case ImageClickAction.ToggleSet: {
              const lastSet = parseInt(window.localStorage.getItem("set"));
              if (!lastSet) Danbooru.error(`Error: no set selected`);
              else PostActions.toggleSet(lastSet, data.uid);
              break;
            }
            default: {
              link.off("click.re621.dbl-extra");
              link[0].click();
            }
          }

        });

        const image = $("<img>")
          .attr({
            src: getPreviewLink(imageData[0]),
            hztarget: "subitem",
          })
          .appendTo(link)
          .one("load", () => {
            // This is a workaround to avoid empty thumbnails
            // The preview gets loaded first, then a sample replaces it if necessary
            if (this.loadLargeThumbs && !image.attr("error"))
              image
                .attr("src", getSampleLink(imageData[0], imageData[1] == "true", imageData[2]))
                .one("error", () => {
                  image.attr("src", Page.getDeletedPreviewURL());
                });
          })
          .one("error", () => {
            image.attr("error", "true");
            image.attr("src", Page.getDeletedPreviewURL());
          });

        let favBusy = false;
        $("<a>")
          .addClass("fav-link")
          .attr("title", "Favorite")
          .html(Icons.get("star"))
          .appendTo(result)
          .on("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (favBusy) return;
            favBusy = true;

            const favorite = result.attr("fav") !== "true";
            const success = favorite
              ? await PostActions.addFavorite(data.uid)
              : await PostActions.removeFavorite(data.uid);

            if (success) {
              data.fav = favorite;
              result.attr("fav", favorite + "");
              this.cache.save();
            } else Danbooru.error(`Error: unable to ${favorite ? "add post to" : "remove post from"} favorites`);

            favBusy = false;
          });

        $("<a>")
          .addClass("delete-link")
          .html(`<span>${Icons.get("times")}</span>`)
          .appendTo(result)
          .on("click", (event) => {
            event.preventDefault;
            deleteFunction(timestamp, result);
          });
      })
      .on("re621:reset", () => {
        result.html("");
      });

    // Used by `applyFilters()`. Kept outside of the render event, since the contents get reset
    result.data("bl", data.bl || []);

    return result;

    function getPreviewLink (md5: string): string {
      if (!md5) return Page.getDeletedPreviewURL();
      return Page.getStaticURL(`data/preview/${md5.substr(0, 2)}/${md5.substr(2, 2)}/${md5}.jpg`);
    }

    function getSampleLink (md5: string, hasSample: boolean, ext = "jpg"): string {
      if (!md5) return Page.getDeletedPreviewURL();
      return hasSample
        ? Page.getStaticURL(`data/sample/${md5.substr(0, 2)}/${md5.substr(2, 2)}/${md5}.jpg`)
        : Page.getStaticURL(`data/${md5.substr(0, 2)}/${md5.substr(2, 2)}/${md5}.${ext}`);
    }
  }

  protected execPostDraw (): void {
    this.drawFilterPanel();
    this.applyFilters();
  }

  /** Adds the filter settings to the top of the canvas */
  private drawFilterPanel (): void {

    const $panel = $("<sb-filters>").prependTo(this.getCanvasElement());

    // Hide favorited
    $("<label>")
      .addClass("sb-filter")
      .append(
        $("<input>")
          .attr("type", "checkbox")
          .prop("checked", this.fetchSettings<boolean>("hideFavorited") === true)
          .on("change", async (event) => {
            await this.pushSettings("hideFavorited", (event.currentTarget as HTMLInputElement).checked);
            this.applyFilters();
          }),
        $("<span>").text("Hide already favorited"),
      )
      .appendTo($panel);

    // Blacklist - only the filters that actually match at least one of the updates
    const counts = new Map<string, number>();
    this.cache.forEach((data) => {
      for (const filter of data.bl || [])
        counts.set(filter, (counts.get(filter) || 0) + 1);
    });
    if (counts.size == 0) return;

    const shown = new Set<string>(this.fetchSettings<string[]>("blacklistShown") || []);

    const $group = $("<sb-filter-group>")
      .append($("<div>").addClass("sb-filter-title").text("Blacklist").attr("title", "Checked filters are hidden. Uncheck to show the matching posts."))
      .appendTo($panel);

    for (const [filter, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      $("<label>")
        .addClass("sb-filter")
        .append(
          $("<input>")
            .attr("type", "checkbox")
            .prop("checked", !shown.has(filter))
            .on("change", async (event) => {
              if ((event.currentTarget as HTMLInputElement).checked) shown.delete(filter);
              else shown.add(filter);
              await this.pushSettings("blacklistShown", [...shown]);
              this.applyFilters();
            }),
          $("<span>").addClass("sb-filter-name").text(filter),
          $("<span>").addClass("sb-filter-count").text(count),
        )
        .appendTo($group);
    }
  }

  /** Hides the updates that are excluded by the filter settings */
  private applyFilters (): void {
    const hideFavorited = this.fetchSettings<boolean>("hideFavorited") === true;
    const shown = new Set<string>(this.fetchSettings<string[]>("blacklistShown") || []);

    for (const el of this.getCanvasElement().find("subitem").get()) {
      const $el = $(el);
      const filters: string[] = $el.data("bl") || [];
      const hidden = (hideFavorited && $el.attr("fav") == "true") || filters.some(filter => !shown.has(filter));

      if (hidden) $el.attr("filtered", "true");
      else $el.removeAttr("filtered");
    }

    SubscriptionManager.trigger("attributes." + this.getTrackerID());
  }

  protected formatSubscriptionListEntry (id: string, value: any, unsub: (name: string) => void): JQuery<HTMLElement> {

    const formattedID = id.replace(/_/g, " ").toLowerCase();
    const result = $("<sb-enitem>")
      .attr({
        content: id + " " + formattedID,
        sort: id.toLowerCase(),
      });

    $("<a>")
      .addClass("sb-unsub")
      .html(Icons.get("times"))
      .attr({ "title": "Unsubscribe" })
      .appendTo(result)
      .on("click", (event) => {
        event.preventDefault();
        unsub(id);
      });

    $("<a>")
      .html(id)
      .attr({ "href": "/wiki_pages/show_or_new?title=" + id })
      .appendTo(result);

    return result;
  }

}
