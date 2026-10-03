import { expect } from "chai";
import {
  buildRows,
  previewRows,
  resolveRow,
  formatCreators,
  DialogController,
} from "../../src/modules/dialog/classify-dialog";
import type { LanguageClassifier } from "../../src/modules/classifiers/types";

const fakeWin = { setTimeout: (fn: () => void) => fn() } as unknown as Window;

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

describe("classify-dialog", function () {
  describe("buildRows", function () {
    it("creates one pending row per item", function () {
      const rows = buildRows([makeItem("Hello World")]);
      expect(rows).to.have.length(1);
      expect(rows[0].status).to.equal("pending");
      expect(rows[0].code).to.be.null;
    });

    it("captures the item's current (pre-replacement) language field", function () {
      const rows = buildRows([makeItem("Titel", "", "German")]);
      expect(rows[0].currentLanguage).to.equal("German");
    });

    it("formats the row's creators summary from the item's creators", function () {
      const rows = buildRows([
        makeItem("Title", "", "", [
          { lastName: "Smith" },
          { lastName: "Jones" },
        ]),
      ]);
      expect(rows[0].creators).to.equal("Smith et al.");
    });
  });

  describe("formatCreators", function () {
    it("returns an empty string for no creators", function () {
      expect(formatCreators([])).to.equal("");
    });

    it("returns the last name alone for a single creator", function () {
      expect(formatCreators([{ lastName: "Smith" }])).to.equal("Smith");
    });

    it("appends 'et al.' when there is more than one creator", function () {
      expect(
        formatCreators([{ lastName: "Smith" }, { lastName: "Jones" }]),
      ).to.equal("Smith et al.");
    });
  });

  describe("previewRows", function () {
    it("fills in code and reliable for each row", function () {
      const rows = buildRows([
        makeItem("Hello World, a long enough title"),
        makeItem("bonjour le monde, un titre assez long"),
      ]);
      previewRows(rows, fakeClassifier);
      expect(rows[0].code).to.equal("en");
      expect(rows[0].reliable).to.be.true;
      expect(rows[1].code).to.equal("fr");
    });

    it("leaves code null when the classifier returns null", function () {
      const rows = buildRows([makeItem("")]);
      previewRows(rows, fakeClassifier);
      expect(rows[0].code).to.be.null;
    });

    it("leaves code null and doesn't throw when the classifier throws", function () {
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

  describe("DialogController row exclusion", function () {
    it("rowData() marks a fresh row as not highlighted", function () {
      const rows = buildRows([makeItem("Title")]);
      const controller = new DialogController(fakeWin, rows);
      expect(controller.rowData(0).highlighted).to.equal("");
    });

    it("rowData() highlights an excluded row and prefixes change with 🚫", function () {
      const rows = buildRows([makeItem("Title")]);
      rows[0].code = "en";
      rows[0].excluded = true;
      const controller = new DialogController(fakeWin, rows);
      const data = controller.rowData(0);
      expect(data.highlighted).to.equal("1");
      expect(data.change.startsWith("🚫 ")).to.be.true;
    });

    it("runApply() skips excluded rows even when they have a code", async function () {
      const item = makeItem("Title") as unknown as Parameters<
        typeof buildRows
      >[0][number] & {
        setField(f: string, v: string): void;
        saveTx(): Promise<unknown>;
      };
      let saved = false;
      item.setField = () => {
        saved = true;
      };
      item.saveTx = async () => {};
      const rows = buildRows([item]);
      rows[0].code = "en";
      rows[0].excluded = true;
      const controller = new DialogController(fakeWin, rows);
      await controller.runApply();
      expect(saved).to.be.false;
      expect(rows[0].status).to.equal("pending");
    });
  });

  describe("resolveRow", function () {
    function row(language: string) {
      const r = buildRows([makeItem("Hello World", "", language)])[0];
      r.detected = { code: "en", reliable: true };
      return r;
    }
    const opt = (overwrite: boolean, convert = false) => ({
      overwrite,
      convert,
    });

    it("fills an empty field regardless of options", function () {
      const r = row("");
      resolveRow(r, opt(false));
      expect(r.code).to.equal("en");
    });

    it("leaves existing values untouched unless overwrite is on", function () {
      for (const lang of ["fr", "deu", "xyz"]) {
        const r = row(lang);
        resolveRow(r, opt(false));
        expect(r.code, lang).to.be.null;
      }
    });

    it("overwrites existing values with the detection when overwrite is on", function () {
      for (const lang of ["fr", "deu", "xyz"]) {
        const r = row(lang);
        resolveRow(r, opt(true));
        expect(r.code, lang).to.equal("en");
      }
    });

    it("converts mappable values when overwrite and convert are on", function () {
      const r = row("deu");
      resolveRow(r, opt(true, true));
      expect(r.code).to.equal("de");
    });

    it("falls back to detection for unmappable values and keeps valid codes detected", function () {
      const a = row("xyz");
      resolveRow(a, opt(true, true));
      expect(a.code).to.equal("en");
      const b = row("fr");
      resolveRow(b, opt(true, true));
      expect(b.code).to.equal("en");
    });

    it("never converts without overwrite", function () {
      const r = row("deu");
      resolveRow(r, opt(false, true));
      expect(r.code).to.be.null;
    });
  });
});
