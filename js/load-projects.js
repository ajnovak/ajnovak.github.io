/* Reads the portfolio's projects from one plain-text file at runtime:
   assets/projects/projects.txt. Each project is a block of "key: value"
   lines, blocks are separated by a line of only "---", and lines starting
   with "#" are comments. A project's images live in
   assets/projects/<folder>/thumbs and /full. */
(function () {
    "use strict";

    var PROJECTS_ROOT = "assets/projects/";

    // Fields whose values are comma-separated. Any other key is plain text.
    var LIST_FIELDS = ["product", "purpose", "client", "tools"];

    // Fields a single image can override with its own values.
    var OVERRIDE_FIELDS = ["product", "purpose"];

    function fetchText(url) {
        return fetch(url).then(function (response) {
            if (!response.ok) {
                throw new Error(url + " returned " + response.status);
            }
            return response.text();
        });
    }

    function splitLines(text) {
        return text.replace(/^﻿/, "").split(/\r?\n/);
    }

    function splitList(value) {
        return value.split(",").map(function (part) {
            return part.trim();
        }).filter(Boolean);
    }

    var TAG_KEYS = OVERRIDE_FIELDS.concat(["all", "archive"]);

    // True when every ";"-separated piece is "known_key=value".
    function isTags(text) {
        return text.split(";").every(function (pair) {
            var equals = pair.indexOf("=");
            return !pair.trim() || (equals !== -1 && TAG_KEYS.indexOf(pair.slice(0, equals).trim()) !== -1);
        });
    }

    function parseImage(value, folder) {
        var parts = value.split("|").map(function (part) {
            return part.trim();
        });
        var file = parts[0];
        // Tags: per-map filter values that replace the project's, e.g.
        // "purpose=wayfinding; product=signage".
        // "all=no" keeps a map in its project but off the "All images" grid.
        // "archive=yes" hides it everywhere, keeping the line for later.
        // Any part after the title made only of known tags counts as tags, so
        // a skipped caption or an extra "|" doesn't lose them.
        var caption = "";
        var tags = [];
        parts.slice(2).forEach(function (part, i) {
            if (part && isTags(part)) {
                tags.push(part);
            } else if (i === 0) {
                caption = part;
            }
        });
        var overrides = {};
        var inAll = true;
        var archived = false;
        tags.join(";").split(";").forEach(function (pair) {
            var equals = pair.indexOf("=");
            var field = pair.slice(0, equals).trim();
            var value = pair.slice(equals + 1).trim();
            if (equals === -1) {
                return;
            }
            if (field === "all") {
                inAll = value.toLowerCase() !== "no";
            } else if (field === "archive") {
                archived = value.toLowerCase() === "yes";
            } else if (OVERRIDE_FIELDS.indexOf(field) !== -1) {
                overrides[field] = splitList(value);
            }
        });
        return {
            file: file,
            inAll: inAll,
            archived: archived,
            title: parts[1] || "",
            caption: caption,
            overrides: overrides,
            thumb: PROJECTS_ROOT + folder + "/thumbs/" + file,
            full: PROJECTS_ROOT + folder + "/full/" + file
        };
    }

    // One block of lines -> one project, or null if it shouldn't be shown.
    function parseBlock(lines) {
        var project = { images: [], awards: [] };
        var imageLines = [];
        LIST_FIELDS.forEach(function (field) {
            project[field] = [];
        });

        lines.forEach(function (line) {
            // Split on the first colon only, so URLs and captions stay intact.
            var colon = line.indexOf(":");
            if (colon === -1) {
                return;
            }
            var key = line.slice(0, colon).trim();
            var value = line.slice(colon + 1).trim();
            if (!key) {
                return;
            }

            if (key === "image") {
                if (value) {
                    imageLines.push(value);
                }
            } else if (key === "award") {
                // "award: Text | optional link"; one line per award.
                if (value) {
                    var award = value.split("|");
                    project.awards.push({ text: award[0].trim(), url: (award[1] || "").trim() });
                }
            } else if (LIST_FIELDS.indexOf(key) !== -1) {
                project[key] = splitList(value);
            } else {
                project[key] = value;
            }
        });

        // "hidden: yes" (or the older "archive: yes") leaves a project out.
        if (/^yes$/i.test(project.hidden || "") || /^yes$/i.test(project.archive || "")) {
            return null;
        }
        if (!project.folder) {
            // A block of only comments (the file's header) is skipped quietly.
            if (project.project) console.warn("Skipping project \"" + (project.project || "?") + "\": no folder line");
            return null;
        }

        imageLines.forEach(function (value) {
            var image = parseImage(value, project.folder);
            if (!image.archived) {
                project.images.push(image);
            }
        });
        if (!project.images.length) {
            console.warn("Skipping project \"" + project.folder + "\": no image lines");
            return null;
        }

        // Each map's own filter values: its overrides, else the project's.
        project.images.forEach(function (image) {
            OVERRIDE_FIELDS.forEach(function (field) {
                image[field] = image.overrides[field] || project[field];
            });
        });

        project.cover = project.images[0];
        return project;
    }

    window.loadProjects = function () {
        return fetchText(PROJECTS_ROOT + "projects.txt").then(function (text) {
            var blocks = [[]];
            splitLines(text).forEach(function (line) {
                var trimmed = line.trim();
                if (trimmed === "---") {
                    blocks.push([]);
                } else if (trimmed.charAt(0) !== "#") {
                    blocks[blocks.length - 1].push(line);
                }
            });
            return blocks.map(parseBlock).filter(Boolean);
        });
    };
}());
