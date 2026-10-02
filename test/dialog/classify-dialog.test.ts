import { expect } from "chai";
import {
  buildRows,
  previewRows,
} from "../../src/modules/dialog/classify-dialog";
import type { LanguageClassifier } from "../../src/modules/classifiers/types";

function makeItem(title: string, abstractNote = "") {
  const fields: Record<string, string> = { title, abstractNote, language: "" };
  return {
    isRegularItem: () => true,
    library: { editable: true },
    getField: (f: string) => fields[f] ?? "",
    itemType: "journalArticle",
  };
}

const fakeClassifier: LanguageClassifier = {
  id: "fake",
  classify(text) {
    if (!text.trim()) return null;
    return {
      code: text.includes("bonjour") ? "fr" : "en",
      reliable: text.length > 20,
    };
  },
};

describe("buildRows", () => {
  it("creates one pending row per item", () => {
    const rows = buildRows([makeItem("Hello World")]);
    expect(rows).to.have.length(1);
    expect(rows[0].status).to.equal("pending");
    expect(rows[0].code).to.be.null;
  });
});

describe("previewRows", () => {
  it("fills in code and reliable for each row", () => {
    const rows = buildRows([
      makeItem("Hello World, a long enough title"),
      makeItem("bonjour le monde, un titre assez long"),
    ]);
    previewRows(rows, fakeClassifier);
    expect(rows[0].code).to.equal("en");
    expect(rows[0].reliable).to.be.true;
    expect(rows[1].code).to.equal("fr");
  });

  it("leaves code null when the classifier returns null", () => {
    const rows = buildRows([makeItem("")]);
    previewRows(rows, fakeClassifier);
    expect(rows[0].code).to.be.null;
  });
});
