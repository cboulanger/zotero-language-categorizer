import { expect } from "chai";
import { isEligible, getEligibleItems, type ScannableItem } from "../src/modules/scan";

function makeItem(
  overrides: Partial<{
    isRegular: boolean;
    editable: boolean;
    language: string;
    title: string;
    abstractNote: string;
  }> = {},
): ScannableItem {
  const {
    isRegular = true,
    editable = true,
    language = "",
    title = "Some Title",
    abstractNote = "",
  } = overrides;
  const fields: Record<string, string> = { language, title, abstractNote };
  return {
    isRegularItem: () => isRegular,
    library: { editable },
    getField: (field: string) => fields[field] ?? "",
  };
}

describe("isEligible", () => {
  it("accepts a regular editable item with no language and a title", () => {
    expect(isEligible(makeItem())).to.be.true;
  });

  it("rejects a non-regular item (note/attachment)", () => {
    expect(isEligible(makeItem({ isRegular: false }))).to.be.false;
  });

  it("rejects an item in a read-only library", () => {
    expect(isEligible(makeItem({ editable: false }))).to.be.false;
  });

  it("rejects an item that already has a valid ISO 639-1 code", () => {
    expect(isEligible(makeItem({ language: "fr" }))).to.be.false;
  });

  it("rejects an item whose code has a region subtag", () => {
    expect(isEligible(makeItem({ language: "en-US" }))).to.be.false;
  });

  it("accepts an item whose language field is a spelled-out name, not a code", () => {
    expect(isEligible(makeItem({ language: "German" }))).to.be.true;
  });

  it("accepts an item whose language field is empty after trimming", () => {
    expect(isEligible(makeItem({ language: "   " }))).to.be.true;
  });

  it("rejects an item with no title and no abstract", () => {
    expect(isEligible(makeItem({ title: "", abstractNote: "" }))).to.be.false;
  });

  it("accepts an item with only an abstract and no title", () => {
    expect(
      isEligible(makeItem({ title: "", abstractNote: "Some abstract text." })),
    ).to.be.true;
  });
});

describe("getEligibleItems", () => {
  it("filters a mixed list down to eligible items only", () => {
    const items = [
      makeItem(),
      makeItem({ language: "en" }),
      makeItem({ isRegular: false }),
    ];
    expect(getEligibleItems(items)).to.deep.equal([items[0]]);
  });
});
