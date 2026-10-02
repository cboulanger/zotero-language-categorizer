import { expect } from "chai";
import {
  buildRows,
  previewRows,
  formatCreators,
} from "../../src/modules/dialog/classify-dialog";
import type { LanguageClassifier } from "../../src/modules/classifiers/types";

function makeItem(
  title: string,
  abstractNote = "",
  language = "",
  creators: { lastName: string }[] = [],
) {
  const fields: Record<string, string> = { title, abstractNote, language };
  return {
    isRegularItem: () => true,
    library: { editable: true },
    getField: (f: string) => fields[f] ?? "",
    getCreators: () => creators,
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

  it("captures the item's current (pre-replacement) language field", () => {
    const rows = buildRows([makeItem("Titel", "", "German")]);
    expect(rows[0].currentLanguage).to.equal("German");
  });

  it("formats the row's creators summary from the item's creators", () => {
    const rows = buildRows([
      makeItem("Title", "", "", [{ lastName: "Smith" }, { lastName: "Jones" }]),
    ]);
    expect(rows[0].creators).to.equal("Smith et al.");
  });
});

describe("formatCreators", () => {
  it("returns an empty string for no creators", () => {
    expect(formatCreators([])).to.equal("");
  });

  it("returns the last name alone for a single creator", () => {
    expect(formatCreators([{ lastName: "Smith" }])).to.equal("Smith");
  });

  it("appends 'et al.' when there is more than one creator", () => {
    expect(
      formatCreators([{ lastName: "Smith" }, { lastName: "Jones" }]),
    ).to.equal("Smith et al.");
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

  it("leaves code null and doesn't throw when the classifier throws", () => {
    const throwingClassifier: LanguageClassifier = {
      id: "throwing",
      classify() {
        throw new Error("boom");
      },
    };
    const rows = buildRows([makeItem("Hello World")]);
    expect(() => previewRows(rows, throwingClassifier)).to.not.throw();
    expect(rows[0].code).to.be.null;
  });
});
