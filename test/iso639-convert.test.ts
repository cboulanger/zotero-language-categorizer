import { expect } from "chai";
import {
  convertLanguageValue,
  resetConvertIndexForTests,
} from "../src/modules/iso639-convert";

describe("convertLanguageValue", function () {
  beforeEach(resetConvertIndexForTests);

  it("maps ISO 639-3 / 639-2 codes to 639-1", function () {
    expect(convertLanguageValue("deu")).to.equal("de");
    expect(convertLanguageValue("ger")).to.equal("de");
    expect(convertLanguageValue("fra")).to.equal("fr");
    expect(convertLanguageValue("fre")).to.equal("fr");
  });

  it("is case- and whitespace-insensitive", function () {
    expect(convertLanguageValue("  ENG ")).to.equal("en");
  });

  it("maps English language names", function () {
    expect(convertLanguageValue("German")).to.equal("de");
  });

  it("returns null for valid 639-1 values and unmappable input", function () {
    expect(convertLanguageValue("de")).to.be.null;
    expect(convertLanguageValue("xyz")).to.be.null;
    expect(convertLanguageValue("")).to.be.null;
  });
});
