/* index.html's portfolio: filters, project grid, project view, and lightbox.
   Project data comes from loadProjects() in load-projects.js. */
(function () {
    "use strict";

    // Filter groups, in display order. A group appears once its field has at
    // least two different values across all projects. Chips follow "order";
    // a value not listed there goes after, alphabetically. "hints" become
    // the chip's hover text.
    // One group, "category" in projects.txt: the old product and purpose
    // tags merged into a single row (with only one group, no tabs show).
    var FILTER_GROUPS = [
        {
            field: "category",
            label: "Category",
            order: ["planning", "interactive", "publication", "outreach", "wayfinding", "design"],
            hints: {
                planning: "Plans and reports: comprehensive, master, and vision plans",
                interactive: "Web maps, apps, dashboards, StoryMaps, and scrollytelling",
                publication: "Books, articles, and survey publications",
                outreach: "Public engagement and promotional maps",
                wayfinding: "Signs, kiosks, and trail maps",
                design: "Posters and art maps where the design leads"
            }
        }
    ];

    var projects = [];
    var selected = {};        // field -> Set of lowercase values
    var activeField = null;   // category whose filters are on screen
    var current = null;       // project being viewed, or null on the grid
    var slide = 0;
    var browseScroll = 0;
    var lastFolder = null;
    var openedFromGrid = false; // true when Back returns to the project list
    var allImages = [];       // { image, project } for every map, in order
    var viewer = [];          // { image, project } the lightbox steps through

    function el(id) {
        return document.getElementById(id);
    }

    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function capitalize(value) {
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    /* ---------- Filtering ---------- */

    // Works on a project or on one map, which carries its own filter values.
    function matchesFilters(item) {
        // Any value within a group may match; every active group must match.
        return Object.keys(selected).every(function (field) {
            var values = selected[field];
            return values.size === 0 || item[field].some(function (value) {
                return values.has(value.toLowerCase());
            });
        });
    }

    // A project matches when it, or any of its maps (which can carry their own
    // filter values), does.
    function projectMatches(project) {
        return matchesFilters(project) || project.images.some(function (image) {
            return image.inAll && matchesFilters(image);
        });
    }

    function activeFilterCount() {
        return Object.keys(selected).reduce(function (total, field) {
            return total + selected[field].size;
        }, 0);
    }

    /* ---------- Grid ---------- */

    // Masonry needs each thumbnail's shape before the cards are placed. A
    // browser knows an image's dimensions as soon as its header arrives, well
    // before the whole file has downloaded, so check for them rather than wait
    // for load. Results are stored on the image entry, so each is measured once.
    function measureImage(entry) {
        if (entry.measured) {
            return entry.measured;
        }
        entry.measured = new Promise(function (resolve) {
            var image = new Image();
            var timer = setInterval(function () {
                if (image.naturalWidth) {
                    finish();
                }
            }, 50);

            function finish() {
                clearInterval(timer);
                entry.width = image.naturalWidth;
                entry.height = image.naturalHeight;
                resolve();
            }

            image.onload = finish;
            image.onerror = finish;
            image.src = entry.thumb;
        });
        return entry.measured;
    }

    // Reserves an image's height before it paints, so cards don't jump.
    function sizeImage(img, entry) {
        if (entry.width) {
            img.width = entry.width;
            img.height = entry.height;
        }
    }

    // A muted loop in place of an image ({ src, thumb }: the clip and its
    // poster, which sizes it). It downloads only once it nears the screen,
    // and with reduced motion it stays on its poster.
    function makeClip(clip, label) {
        var video = make("video");
        sizeImage(video, clip);
        video.poster = clip.thumb;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "none";
        video.setAttribute("aria-label", label);
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            new IntersectionObserver(function (entries, observer) {
                if (entries[0].isIntersecting) {
                    observer.disconnect();
                    video.src = clip.src;
                    video.play().catch(function () {});
                }
            }, { rootMargin: "400px" }).observe(video);
        }
        return video;
    }

    function buildCard(project) {
        var card = make("a", "pf-card");
        card.href = "#" + project.folder;
        card.dataset.folder = project.folder;
        // A wide cover can span more than one column ("card_span:").
        if (parseInt(project.card_span, 10) > 1) {
            card.dataset.span = parseInt(project.card_span, 10);
        }
        // Or it can keep to one column ("card_column:", counted from the left)
        // wherever the grid has that many.
        if (parseInt(project.card_column, 10) > 0) {
            card.dataset.column = parseInt(project.card_column, 10);
        }

        var frame = make("span", "pf-card-image");
        if (project.cardVideo) {
            frame.appendChild(makeClip(project.cardVideo, project.cover.title));
        } else {
            var image = make("img");
            sizeImage(image, project.cover);
            image.src = project.cover.thumb;
            image.alt = project.cover.title;
            frame.appendChild(image);
        }

        var body = make("span", "pf-card-body");
        body.appendChild(make("span", "pf-card-title", project.project));
        // Just the year under the title.
        body.appendChild(make("span", "pf-card-year", project.year || ""));
        // A headline award ("badge:" in projects.txt) under the name.
        if (project.badge) {
            body.appendChild(make("span", "pf-card-award", project.badge));
        }

        card.appendChild(frame);
        card.appendChild(body);
        return card;
    }

    // Masonry: each card spans enough of the grid's short (2px) rows to fit
    // its height and goes into the shortest column. A wide card ("card_span")
    // needs its columns level to sit without a gap above, so up to WIDE_PICKS
    // of the next WIDE_WINDOW cards may go ahead of it, chosen so their
    // heights fill the short columns as evenly as possible. Cards stay in
    // projects.txt order in the page, for keyboard users.
    var WIDE_WINDOW = 10;
    var WIDE_PICKS = 5;

    function layoutGrid(grid) {
        grid = grid || el("pf-grid");
        var styles = window.getComputedStyle(grid);
        var rowHeight = parseFloat(styles.gridAutoRows);
        var gap = parseFloat(styles.columnGap);
        var columns = styles.gridTemplateColumns.split(" ").length;
        var cards = Array.prototype.slice.call(grid.children);

        // Widths first (a wide card's width decides its height), then read
        // every height in one pass.
        cards.forEach(function (card) {
            var span = Math.min(parseInt(card.dataset.span, 10) || 1, columns);
            card.style.gridColumn = span > 1 ? "span " + span : "";
            card.style.gridRow = "";
        });
        var items = cards.map(function (card) {
            return {
                card: card,
                span: Math.min(parseInt(card.dataset.span, 10) || 1, columns),
                rows: Math.ceil((card.offsetHeight + gap) / rowHeight),
                column: parseInt(card.dataset.column, 10) || 0
            };
        });

        function level() {
            var h = [];
            for (var c = 0; c < columns; c++) {
                h.push(0);
            }
            return h;
        }

        function shortest(h) {
            return h.indexOf(Math.min.apply(null, h));
        }

        // A narrow card's column: its pinned one ("card_column"), or the
        // shortest.
        function columnFor(item, h) {
            return item.column && item.column <= columns ? item.column - 1 : shortest(h);
        }

        // Where a wide card would go now: the run of columns whose tallest
        // foot is lowest, and the whitespace it would leave above itself.
        function widePlace(h, span) {
            var best = null;
            for (var s = 0; s + span <= columns; s++) {
                var run = h.slice(s, s + span);
                var top = Math.max.apply(null, run);
                var waste = run.reduce(function (sum, x) {
                    return sum + top - x;
                }, 0);
                if (!best || waste < best.waste || (waste === best.waste && top < best.top)) {
                    best = { start: s, top: top, waste: waste };
                }
            }
            return best;
        }

        // Lays cards out in the given order, from level columns; with apply,
        // writes each card's place. Returns the columns' heights.
        function run(seq, apply) {
            var h = level();
            seq.forEach(function (item) {
                var start, top;
                if (item.span === 1) {
                    start = columnFor(item, h);
                    top = h[start];
                } else {
                    var spot = widePlace(h, item.span);
                    start = spot.start;
                    top = spot.top;
                }
                if (apply) {
                    item.card.style.gridColumn = (start + 1) + " / span " + item.span;
                    item.card.style.gridRow = (top + 1) + " / span " + item.rows;
                }
                for (var j = start; j < start + item.span; j++) {
                    h[j] = top + item.rows;
                }
            });
            return h;
        }

        // First, the order to place cards in. At each wide card, search
        // orders of up to WIDE_PICKS of the narrow cards that follow (each
        // into its column) for the one leaving least space above it; fewer
        // picks win ties, keeping the list's order.
        var seq = [];
        var queue = items.slice();
        while (queue.length) {
            var item = queue.shift();
            if (item.span === 1) {
                seq.push(item);
                continue;
            }
            var ahead = [];
            for (var k = 0; k < queue.length && ahead.length < WIDE_WINDOW && queue[k].span === 1; k++) {
                ahead.push(k);
            }
            var heights = run(seq, false);
            var best = { waste: widePlace(heights, item.span).waste, picks: [] };
            (function search(h, picks) {
                if (best.waste === 0 || picks.length === WIDE_PICKS) {
                    return;
                }
                ahead.forEach(function (qi) {
                    if (picks.indexOf(qi) !== -1) {
                        return;
                    }
                    var next = h.slice();
                    next[columnFor(queue[qi], next)] += queue[qi].rows;
                    var tried = picks.concat(qi);
                    var waste = widePlace(next, item.span).waste;
                    if (waste < best.waste) {
                        best = { waste: waste, picks: tried };
                    }
                    search(next, tried);
                });
            })(heights, []);
            best.picks.forEach(function (qi) {
                seq.push(queue[qi]);
            });
            queue = queue.filter(function (q, qi) {
                return best.picks.indexOf(qi) === -1;
            });
            seq.push(item);
        }

        // A wide card still left over a big gap (as in a short, filtered
        // list, with nothing after it to fill the columns) moves up the list
        // just far enough to sit on level columns; at the top it always does.
        var limit = Math.round(60 / rowHeight);
        seq.slice().forEach(function (item) {
            if (item.span === 1) {
                return;
            }
            var at = seq.indexOf(item);
            if (widePlace(run(seq.slice(0, at), false), item.span).waste <= limit * item.span) {
                return;
            }
            var to = at - 1;
            while (to > 0 && widePlace(run(seq.slice(0, to), false), item.span).waste > limit * item.span) {
                to--;
            }
            seq.splice(at, 1);
            seq.splice(to, 0, item);
        });

        run(seq, true);
    }

    function renderGrid() {
        var count = activeFilterCount();
        var grid = el("pf-grid");
        grid.textContent = "";

        var total = projects.length;
        var matches = projects.filter(projectMatches);
        matches.forEach(function (project) {
            grid.appendChild(buildCard(project));
        });
        layoutGrid();

        function plural(n, noun) {
            return n + " " + noun + (n === 1 ? "" : "s");
        }
        var status;
        if (matches.length === 0) {
            status = "Nothing matches. Try removing a filter.";
        } else if (count) {
            status = matches.length + " of " + plural(total, "project");
        } else {
            status = plural(total, "project");
        }
        el("pf-status").textContent = status;
        el("pf-clear").hidden = count === 0;
        updateTabs();
    }

    // Marks the open category's tab and shows its row of filters.
    function updateTabs() {
        Array.prototype.forEach.call(document.querySelectorAll("#pf-filter-tabs .pf-tab"), function (tab) {
            var field = tab.dataset.field;
            tab.textContent = tab.dataset.label;
            tab.setAttribute("aria-pressed", String(field === activeField));
        });
        Array.prototype.forEach.call(document.querySelectorAll(".pf-filter-group"), function (row) {
            row.hidden = row.dataset.field !== activeField;
        });
    }

    // Shows one category's row of filters. Filters chosen in other categories
    // stay on.
    function showCategory(field) {
        activeField = field;
        updateTabs();
    }

    function buildFilters() {
        var container = el("pf-filter-groups");
        var tabs = el("pf-filter-tabs");

        FILTER_GROUPS.forEach(function (group) {
            // Compare case-insensitively; show the first spelling found.
            var values = {};
            function collect(value) {
                var key = value.toLowerCase();
                if (!values[key]) {
                    values[key] = value;
                }
            }
            projects.forEach(function (project) {
                project[group.field].forEach(collect);
            });
            allImages.forEach(function (item) {
                item.image[group.field].forEach(collect);
            });

            var keys = Object.keys(values).sort(function (a, b) {
                var ia = group.order.indexOf(a);
                var ib = group.order.indexOf(b);
                ia = ia === -1 ? Infinity : ia;
                ib = ib === -1 ? Infinity : ib;
                return ia - ib || (a < b ? -1 : a > b ? 1 : 0);
            });
            if (keys.length < 2) {
                return;
            }

            selected[group.field] = new Set();
            if (!activeField) {
                activeField = group.field;
            }

            var tab = make("button", "pf-tab", group.label);
            tab.type = "button";
            tab.dataset.field = group.field;
            tab.dataset.label = group.label;
            tab.setAttribute("aria-controls", "pf-filters-" + group.field);
            tab.addEventListener("click", function () {
                showCategory(group.field);
            });
            tabs.appendChild(tab);

            var row = make("div", "pf-filter-group");
            row.id = "pf-filters-" + group.field;
            row.dataset.field = group.field;
            row.setAttribute("role", "group");
            row.setAttribute("aria-label", group.label);
            // Chips get their own box so a wrapped line lines up under the
            // first chip.
            var chips = make("div", "pf-chips");
            row.appendChild(chips);

            keys.forEach(function (key) {
                var chip = make("button", "pf-chip", capitalize(values[key]));
                chip.type = "button";
                if (group.hints[key]) {
                    chip.title = group.hints[key];
                }
                chip.setAttribute("aria-pressed", "false");
                chip.addEventListener("click", function () {
                    // One filter at a time: choosing one clears any other,
                    // in either category (the categories rarely overlap, so
                    // combining them mostly found nothing); choosing it
                    // again clears it.
                    var on = !selected[group.field].has(key);
                    Object.keys(selected).forEach(function (field) {
                        selected[field].clear();
                    });
                    Array.prototype.forEach.call(document.querySelectorAll(".pf-chip"), function (other) {
                        other.setAttribute("aria-pressed", "false");
                    });
                    if (on) {
                        selected[group.field].add(key);
                    }
                    chip.setAttribute("aria-pressed", String(on));
                    renderGrid();
                });
                chips.appendChild(chip);
            });

            container.appendChild(row);
        });

        // A single category needs no tab to choose it.
        tabs.hidden = tabs.children.length < 2;
        updateTabs();
    }

    // Filters narrow the projects: the grid shows the projects with a
    // matching map.
    function clearFilters() {
        Object.keys(selected).forEach(function (field) {
            selected[field].clear();
        });
        Array.prototype.forEach.call(document.querySelectorAll(".pf-chip"), function (chip) {
            chip.setAttribute("aria-pressed", "false");
        });
        renderGrid();
    }

    /* ---------- Project view ---------- */

    // "Created at SE Group for Town of Chester". An employer of "student"
    // (optionally "student at <school>") reads "Created as a student in
    // <course>, <school>", since a student's "client" is a class. Missing
    // parts are left out; the year is shown on its own, at the title's rule.
    function creditLine(project) {
        var employer = (project.employer || "").trim();
        var clients = project.client;
        var student = /^student\b/i.test(employer);
        var text = "Created";

        if (student) {
            var school = employer.replace(/^student\b\s*/i, "");
            text += " as a student" + (school ? " " + school : "");
        } else if (employer) {
            text += " at " + employer;
        }

        if (student && clients.length) {
            text += " in " + clients.join(", ");
        } else if (clients.length) {
            var last = clients[clients.length - 1];
            text += " for " + (clients.length > 1
                ? clients.slice(0, -1).join(", ") + " and " + last
                : last);
        }
        return text === "Created" ? "" : text;
    }

    function renderProject(project) {
        el("pf-project-title").textContent = project.project;
        el("pf-project-caption").textContent = project.caption || "";
        // The year at the end of the title's rule, the credit as a sentence
        // ("Created at SE Group for Town of Chester."), and links to the
        // previous and next projects.
        el("pf-year").textContent = project.year || "";
        var awards = el("pf-awards");
        awards.textContent = "";
        project.awards.forEach(function (award) {
            var item = make("li", "pf-award");
            if (award.url) {
                var link = make("a", "", award.text + " ↗");
                link.href = award.url;
                link.target = "_blank";
                link.rel = "noopener";
                item.appendChild(link);
            } else {
                item.textContent = award.text;
            }
            awards.appendChild(item);
        });
        awards.hidden = !project.awards.length;
        var credit = creditLine(project);
        el("pf-credit").textContent = credit ? credit + "." : "";
        var at = projects.indexOf(project);
        [["pf-prev", -1], ["pf-next", 1]].forEach(function (step) {
            var link = el(step[0]);
            var other = projects[(at + step[1] + projects.length) % projects.length];
            link.hidden = projects.length < 2 || at < 0;
            link.href = "#" + other.folder;
            el(step[0] + "-title").textContent = other.project;
        });

        setLink(el("pf-link"), project.link, linkLabel(project));
        // The live map opens from the tag on its picture, not a text link.
        setLink(el("pf-map-link"), "", "");

        // "view: full" shows the full images here instead of the thumbnails
        // (for a thumbnail cropped to a detail). They get their own entries
        // so their shapes don't replace the thumbnails' on the project list.
        if (!project.pageImages) {
            project.pageImages = /^full$/i.test(project.view || "") ? project.images.map(function (image) {
                return { thumb: image.full, title: image.title, caption: image.caption };
            }) : project.images;
            // A project's clip leads its maps too, in place of the cover.
            if (project.cardVideo) {
                var first = project.pageImages[0];
                project.pageImages = [{
                    thumb: project.cardVideo.thumb,
                    src: project.cardVideo.src,
                    video: true,
                    title: first.title,
                    caption: first.caption
                }].concat(project.pageImages.slice(1));
            }
        }

        // Measure every map first so the masonry can place them in one pass.
        var grid = el("pf-map-grid");
        grid.textContent = "";
        return Promise.all(project.pageImages.map(measureImage)).then(function () {
            if (current !== project) {
                return;
            }
            project.pageImages.forEach(function (image, index) {
                grid.appendChild(buildMapCard(image, index));
            });
            layoutMaps();
        });
    }

    // Justified rows: the maps in a row share one height and every row fills
    // the width, so a tall map takes a narrow slot instead of towering over
    // the rest. Of all the ways to split the maps (in order) into rows, the
    // one whose row heights land closest to a comfortable target wins, so a
    // row of tall maps comes out taller and a row of wide maps shorter. A row
    // that would be taller than most of the screen, such as a lone portrait
    // map, is capped and centered instead.
    function layoutMaps() {
        if (!current) {
            return;
        }
        // Rows aim for about 42% of the window's height (at most 440px) and
        // never pass 60% of it, so a map or two and the next row's top show
        // together.
        justify(el("pf-map-grid"), current.pageImages,
            Math.max(220, Math.min(window.innerHeight * 0.42, 440)),
            Math.max(260, window.innerHeight * 0.6), 4,
            /^full$/i.test(current.lead || ""));
    }

    // Lays the map cards in `grid` into justified rows. images[card's
    // data-index] gives each card's shape; rows aim for `target` height and
    // never exceed `tallest`. With leadFull ("lead: full" in projects.txt)
    // the first map takes a row of its own at the full width, however tall.
    function justify(grid, images, target, tallest, most, leadFull) {
        var cards = Array.prototype.slice.call(grid.querySelectorAll(".pf-map-card"));
        var width = grid.clientWidth - 1; // slack for rounding
        if (!cards.length || width <= 0) {
            return;
        }

        var gap = parseFloat(window.getComputedStyle(grid).rowGap) || 16;
        var border = 0; // the frame is drawn inside the image, adding no width
        var mostPerRow = width < 600 ? Math.min(2, most) : most;

        var items = cards.map(function (card) {
            var image = images[card.dataset.index];
            return { card: card, ratio: image.width && image.height ? image.width / image.height : 1 };
        });

        // Height at which maps start..end-1 exactly fill the width.
        function fitHeight(start, end) {
            var ratios = 0;
            for (var i = start; i < end; i++) {
                ratios += items[i].ratio;
            }
            var count = end - start;
            return (width - gap * (count - 1) - border * count) / ratios;
        }

        // best[end] is the lowest total cost of laying out the first `end`
        // maps; a row costs the square of how far its height is from target.
        var first = leadFull ? 1 : 0;
        var best = [];
        var breakAt = [];
        best[first] = 0;
        breakAt[first] = first;
        for (var end = first + 1; end <= items.length; end++) {
            best[end] = Infinity;
            for (var start = Math.max(first, end - mostPerRow); start < end; start++) {
                var miss = fitHeight(start, end) - target;
                var cost = best[start] + miss * miss;
                if (cost < best[end]) {
                    best[end] = cost;
                    breakAt[end] = start;
                }
            }
        }

        var rows = [];
        for (var stop = items.length; stop > first; stop = breakAt[stop]) {
            rows.unshift({ items: items.slice(breakAt[stop], stop), height: fitHeight(breakAt[stop], stop) });
        }
        if (first) {
            rows.unshift({ items: items.slice(0, 1), height: fitHeight(0, 1), full: true });
        }

        grid.textContent = "";
        rows.forEach(function (r) {
            var line = make("div", "pf-map-row");
            var height = r.full ? r.height : Math.min(r.height, tallest);
            r.items.forEach(function (item) {
                var img = item.card.querySelector("img, video");
                img.style.width = (item.ratio * height) + "px";
                img.style.height = height + "px";
                line.appendChild(item.card);
            });
            grid.appendChild(line);
        });
    }

    // A project's link, labeled by what it opens: link_type in projects.txt,
    // or a PDF recognized from its address.
    var LINK_LABELS = {
        document: "Read the full document (PDF)",
        plan: "Read the plan",
        book: "See the book",
        article: "Read the article",
        award: "See the award",
        page: "Visit the project page"
    };

    function linkLabel(project) {
        var type = String(project.link_type || "").toLowerCase();
        if (!LINK_LABELS[type]) {
            type = /\.pdf([?#]|$)/i.test(project.link || "") ? "document" : "page";
        }
        return LINK_LABELS[type] + " ↗";
    }

    // A project's live map (its "map:" line): a story map or an interactive map.
    function liveMapLabel(project) {
        if (project.map_label) {
            return project.map_label;
        }
        return /storymaps\.arcgis\.com/i.test(project.map || "") ? "Open the story map" : "Open the interactive map";
    }

    function setLink(link, url, label) {
        if (!link) {
            return;
        }
        link.hidden = !url;
        if (url) {
            link.href = url;
            link.textContent = label;
        } else {
            link.removeAttribute("href");
        }
    }

    // A map card opens that map full size, or, for a project with a live map,
    // its first card (the live map's picture) opens the live map itself in a
    // new tab, flagged on the image. A clip with no live map to open just
    // plays in place, as do the maps of a project with "zoom: no" (work not
    // yet public: no full-size view, and its full-size files are kept out of
    // the site).
    function buildMapCard(image, index) {
        var live = current && current.map && index === 0;
        var still = !live && (image.video || /^no$/i.test(current.zoom || ""));
        var card = make(live ? "a" : still ? "div" : "button", "pf-card pf-map-card" + (still ? " pf-map-clip" : ""));
        if (live) {
            card.href = current.map;
            card.target = "_blank";
            card.rel = "noopener";
        } else if (!still) {
            card.type = "button";
        }
        card.dataset.index = index;

        var frame = make("span", "pf-card-image");
        if (image.video) {
            frame.appendChild(makeClip(image, image.title));
        } else {
            var img = make("img");
            sizeImage(img, image);
            img.src = image.thumb;
            img.alt = image.title;
            frame.appendChild(img);
        }
        if (live) {
            frame.appendChild(make("span", "pf-card-live", liveMapLabel(current) + " ↗"));
        }

        var body = make("span", "pf-card-body");
        body.appendChild(make("span", "pf-card-title", image.title));
        if (image.caption) {
            body.appendChild(make("span", "pf-card-caption", image.caption));
        }

        card.appendChild(frame);
        // A project's only map needs no title under it: the project's title
        // above already names it (the lightbox still shows it).
        if (current.pageImages.length > 1) {
            card.appendChild(body);
        }
        if (!live && !still) {
            card.addEventListener("click", function () {
                openLightbox(current.images.map(function (each) {
                    return { image: each, project: current };
                }), index);
            });
        }
        return card;
    }

    /* ---------- Lightbox ---------- */

    function step(change) {
        var total = viewer.length;
        slide = (slide + change + total) % total;
        showLightboxImage();
    }

    function showLightboxImage() {
        var item = viewer[slide];
        var image = item.image;
        el("pf-lightbox-project").textContent = item.project.project;
        var full = el("pf-lightbox-img");
        el("pf-lightbox-view").classList.remove("is-zoomed");
        full.src = image.full;
        full.alt = image.title;
        var text = el("pf-lightbox-text");
        text.textContent = "";
        text.appendChild(make("span", "pf-lightbox-map-title", image.title));
        if (image.caption) {
            text.appendChild(make("span", "pf-lightbox-map-caption", image.caption));
        }
    }

    // items: the { image, project } list to step through.
    function openLightbox(items, index) {
        viewer = items;
        slide = index;
        var several = items.length > 1;
        el("pf-lightbox-prev").hidden = !several;
        el("pf-lightbox-next").hidden = !several;
        showLightboxImage();
        el("pf-lightbox").showModal();
        document.body.classList.add("pf-no-scroll");
    }

    function setUpLightbox() {
        var dialog = el("pf-lightbox");
        var view = el("pf-lightbox-view");

        el("pf-lightbox-close").addEventListener("click", function () {
            dialog.close();
        });
        el("pf-lightbox-prev").addEventListener("click", function () {
            step(-1);
        });
        el("pf-lightbox-next").addEventListener("click", function () {
            step(1);
        });

        // Clicking the map toggles fit-to-screen and actual size, for reading
        // small labels. Clicking the empty space left or right of the map
        // steps back or forward; hovering there brightens that side's arrow.
        // Clicking the dimmed page outside the viewer closes it.
        el("pf-lightbox-img").addEventListener("click", function () {
            view.classList.toggle("is-zoomed");
        });

        function sideOf(event) {
            if (event.target !== view || viewer.length < 2) {
                return "";
            }
            var box = el("pf-lightbox-img").getBoundingClientRect();
            return event.clientX < box.left + box.width / 2 ? "prev" : "next";
        }

        view.addEventListener("click", function (event) {
            var side = sideOf(event);
            if (side) {
                step(side === "prev" ? -1 : 1);
            }
        });
        view.addEventListener("mousemove", function (event) {
            var side = sideOf(event);
            if (side) {
                dialog.dataset.hover = side;
            } else {
                delete dialog.dataset.hover;
            }
        });
        view.addEventListener("mouseleave", function () {
            delete dialog.dataset.hover;
        });
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) {
                dialog.close();
            }
        });

        dialog.addEventListener("close", function () {
            document.body.classList.remove("pf-no-scroll");
            el("pf-lightbox-img").removeAttribute("src");
            // Return focus to the map last shown, scrolling to it if the
            // arrows moved past the ones on screen.
            // Skipped if that grid has gone, as when the project link was used.
            var card = document.querySelector('#pf-map-grid [data-index="' + slide + '"]');
            if (card && card.offsetParent) {
                card.focus();
            }
        });
    }

    /* ---------- Routing ---------- */

    // The clicked project's cover and the project's first map are the same
    // image, so during the transition one glides into the other.
    function heroCards(folder) {
        return [
            document.querySelector('#pf-grid .pf-card[data-folder="' + folder + '"]'),
            document.querySelector('#pf-map-grid .pf-map-card[data-index="0"]')
        ];
    }

    function setHero(folder, on) {
        heroCards(folder).forEach(function (card) {
            if (card) {
                card.style.viewTransitionName = "";
            }
        });
        // Only the card currently on screen may carry the name.
        if (on) {
            var cards = heroCards(folder).filter(function (card) {
                return card && card.offsetParent;
            });
            if (cards[0]) {
                cards[0].style.viewTransitionName = "pf-hero";
            }
        }
    }

    // Switching between the list and a project: the cover glides into place
    // while the rest of the page cross-fades (portfolio.css), where the
    // browser supports view transitions; otherwise the page just switches.
    function route(animate) {
        var folder = decodeURIComponent(window.location.hash.slice(1));
        var hero = folder || lastFolder;
        var smooth = animate && document.startViewTransition &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (!smooth) {
            showRoute(folder);
            return;
        }
        setHero(hero, true);
        var transition = document.startViewTransition(function () {
            return showRoute(folder).then(function () {
                setHero(hero, true);
            });
        });
        transition.finished.then(function () {
            setHero(hero, false);
        });
    }

    // Returns a promise that resolves once the new view is fully laid out.
    function showRoute(folder) {
        var project = projects.filter(function (candidate) {
            return candidate.folder === folder;
        })[0];

        if (el("pf-lightbox").open) {
            el("pf-lightbox").close();
        }

        // The panorama above the grid makes way for an open project, and
        // comes back with the grid.
        if (project) {
            if (!current) {
                browseScroll = window.pageYOffset;
            }
            current = project;
            lastFolder = project.folder;
            el("pf-hero").hidden = true;
            el("pf-browse").hidden = true;
            el("pf-project").hidden = false;
            document.title = project.project + " | Austin Novak";
            window.scrollTo(0, 0);
            el("pf-project-title").focus({ preventScroll: true });
            return renderProject(project);
        } else {
            var returning = current !== null;
            current = null;
            el("pf-project").hidden = true;
            el("pf-map-grid").textContent = "";
            el("pf-hero").hidden = false;
            el("pf-browse").hidden = false;
            document.title = "Austin Novak";
            // The grid can't be measured while hidden, and the page must be
            // its full height before the scroll position is restored.
            layoutGrid();
            if (returning) {
                window.scrollTo(0, browseScroll);
                var card = document.querySelector('.pf-card[data-folder="' + lastFolder + '"]');
                if (card) {
                    card.focus({ preventScroll: true });
                }
            }
            return Promise.resolve();
        }
    }

    /* ---------- Start up ---------- */

    function bindEvents() {
        el("pf-clear").addEventListener("click", clearFilters);

        document.addEventListener("keydown", function (event) {
            if (el("pf-lightbox").open) {
                if (viewer.length > 1 && event.key === "ArrowLeft") {
                    step(-1);
                } else if (viewer.length > 1 && event.key === "ArrowRight") {
                    step(1);
                }
                // The dialog closes itself on Escape.
            } else if (current && event.key === "Escape") {
                closeProject();
            }
        });

        window.addEventListener("hashchange", function () {
            if (!current && window.location.hash.length > 1) {
                openedFromGrid = true;
            } else if (window.location.hash.length <= 1) {
                openedFromGrid = false;
            }
            route(true);
        });

        Array.prototype.forEach.call(document.querySelectorAll(".pf-close"), function (button) {
            button.addEventListener("click", function (event) {
                event.preventDefault();
                closeProject();
            });
        });

        // Card heights change with column width, so re-pack when it changes.
        ["pf-grid", "pf-map-grid"].forEach(function (id) {
            var grid = el(id);
            var gridWidth = 0;
            new ResizeObserver(function () {
                var width = grid.clientWidth;
                if (width && width !== gridWidth) {
                    gridWidth = width;
                    if (id === "pf-map-grid") {
                        layoutMaps();
                    } else {
                        layoutGrid(grid);
                    }
                }
            }).observe(grid);
        });
    }

    // Back to the project list, filters and scroll intact. Following an href="#"
    // link would first jump to the top of the page and spoil the transition, so
    // step back in history instead, or, after a direct link to a project, swap
    // the address without a jump.
    function closeProject() {
        if (openedFromGrid) {
            window.history.back();
        } else {
            window.history.pushState(null, "", window.location.pathname + window.location.search);
            route(true);
        }
    }

    function showLoadError(error) {
        console.error(error);
        var message = "The projects couldn't be loaded.";
        if (window.location.protocol === "file:") {
            message += " Browsers block this for pages opened directly from a file, so serve the site with a local server such as VS Code Live Server.";
        }
        el("pf-status").textContent = message;
    }

    if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
    }

    window.loadProjects().then(function (loaded) {
        if (loaded.length === 0) {
            throw new Error("No projects loaded; check the browser console for skipped folders.");
        }

        projects = loaded;
        projects.forEach(function (project) {
            project.images.forEach(function (image) {
                if (image.inAll) {
                    allImages.push({ image: image, project: project });
                }
            });
        });
        return Promise.all(projects.map(function (project) {
            return measureImage(project.cardVideo || project.cover);
        }));
    }).then(function () {
        buildFilters();
        bindEvents();
        setUpLightbox();
        el("pf-controls").hidden = false;
        renderGrid();
        route();
    }).catch(showLoadError);
}());
