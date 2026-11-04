import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useDocument } from "./useDocument.ts";

test("the session starts empty, before any page call runs", () => {
  function Probe() {
    const session = useDocument({ beforeLoad() {}, beforeApply() {}, reveal() {} });
    return createElement("span", null, `${session.doc === null ? "empty" : "loaded"}:${session.names.length}:${session.threadId ?? "none"}`);
  }
  assert.equal(renderToStaticMarkup(createElement(Probe)), "<span>empty:0:none</span>");
});
