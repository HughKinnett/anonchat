import fs from "node:fs";

const htmlPath = "timeline.html";
const jsPath = "timeline.js";
let html = fs.readFileSync(htmlPath, "utf8");
let js = fs.readFileSync(jsPath, "utf8");

const htmlNeedle = `          <div class="feed-tabs" aria-label="Choose posts to show">\n            <button id="show-all-posts" class="feed-tab" type="button" aria-pressed="true">For You</button>\n            <button id="show-latest-posts" class="feed-tab" type="button" aria-pressed="false">Latest</button>\n            <button id="show-following-posts" class="feed-tab" type="button" aria-pressed="false">Following</button>\n            <button id="show-topic-posts" class="feed-tab" type="button" aria-pressed="false">Chosen Topics</button>\n            <button id="show-temporary-posts" class="feed-tab" type="button" aria-pressed="false">Temporary Only</button>\n            <button id="show-saved-filter-posts" class="feed-tab" type="button" aria-pressed="false">Saved Filters</button>\n            <button id="show-profile-posts" class="feed-tab" type="button" aria-pressed="false">My profile</button>\n          </div>`;
const htmlReplacement = `${htmlNeedle}\n          <section class="chosen-topics" aria-labelledby="chosen-topics-title">\n            <h3 id="chosen-topics-title">Choose topics</h3>\n            <div class="chosen-topic-entry">\n              <label class="sr-only" for="chosen-topic-input">Add a topic</label>\n              <input id="chosen-topic-input" type="text" maxlength="40" placeholder="Add a topic or #hashtag" autocomplete="off">\n              <button id="add-chosen-topic" class="secondary-button" type="button">Add topic</button>\n            </div>\n            <div id="chosen-topic-list" class="chosen-topic-list" aria-label="Selected topics"></div>\n            <p id="chosen-topic-status" role="status" aria-live="polite"></p>\n          </section>`;
if (!html.includes(htmlNeedle)) throw new Error("timeline.html feed-tabs block drifted");
html = html.replace(htmlNeedle, htmlReplacement);

const importNeedle = `import { filterFeedPosts, sortFeedPosts } from "./feed-mode-policy.mjs";`;
const importReplacement = `${importNeedle}\nimport { normalizeTopic } from "./topic-policy.mjs";`;
if (!js.includes(importNeedle)) throw new Error("timeline.js feed policy import drifted");
js = js.replace(importNeedle, importReplacement);

const stateNeedle = `let feedMode = "for-you";`;
const stateReplacement = `${stateNeedle}\nlet selectedTopics = new Set();`;
if (!js.includes(stateNeedle)) throw new Error("timeline.js feedMode state drifted");
js = js.replace(stateNeedle, stateReplacement);

const domNeedle = `const savedFilterPostsButton = document.getElementById("show-saved-filter-posts");\nconst profilePostsButton = document.getElementById("show-profile-posts");`;
const domReplacement = `${domNeedle}\nconst chosenTopicInput = document.getElementById("chosen-topic-input");\nconst addChosenTopicButton = document.getElementById("add-chosen-topic");\nconst chosenTopicList = document.getElementById("chosen-topic-list");\nconst chosenTopicStatus = document.getElementById("chosen-topic-status");`;
if (!js.includes(domNeedle)) throw new Error("timeline.js feed controls DOM block drifted");
js = js.replace(domNeedle, domReplacement);

const selectedTopicsNeedle = `        selectedTopics: new Set(),`;
const selectedTopicsReplacement = `        selectedTopics: selectedTopics,`;
if (!js.includes(selectedTopicsNeedle)) throw new Error("timeline.js selectedTopics feed context drifted");
js = js.replace(selectedTopicsNeedle, selectedTopicsReplacement);

const viewNeedle = `const setFeedView = (mode) => {`;
const helpers = `const renderChosenTopics = () => {\n  if (!chosenTopicList) return;\n  chosenTopicList.replaceChildren(...[...selectedTopics].map((topic) => {\n    const chip = document.createElement("button");\n    chip.type = "button";\n    chip.className = "chosen-topic-chip";\n    chip.textContent = \`#\${topic} ×\`;\n    chip.setAttribute("aria-label", \`Remove topic \${topic}\`);\n    chip.addEventListener("click", () => {\n      selectedTopics.delete(topic);\n      renderChosenTopics();\n      if (feedMode === "topics") renderFeed();\n    });\n    return chip;\n  }));\n};\n\nconst addChosenTopic = () => {\n  const topic = normalizeTopic(chosenTopicInput?.value);\n  if (!topic) {\n    if (chosenTopicStatus) chosenTopicStatus.textContent = "Enter a valid topic.";\n    return;\n  }\n  selectedTopics.add(topic);\n  if (chosenTopicInput) chosenTopicInput.value = "";\n  if (chosenTopicStatus) chosenTopicStatus.textContent = \`Added #\${topic}.\`;\n  renderChosenTopics();\n  setFeedView("topics");\n};\n\naddChosenTopicButton?.addEventListener("click", addChosenTopic);\nchosenTopicInput?.addEventListener("keydown", (event) => {\n  if (event.key === "Enter") {\n    event.preventDefault();\n    addChosenTopic();\n  }\n});\n\n${viewNeedle}`;
if (!js.includes(viewNeedle)) throw new Error("timeline.js setFeedView block drifted");
js = js.replace(viewNeedle, helpers);

fs.writeFileSync(htmlPath, html);
fs.writeFileSync(jsPath, js);
