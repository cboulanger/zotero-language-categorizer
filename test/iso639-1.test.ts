import { expect } from "chai";
import { isIso6391Code } from "../src/modules/iso639-1";

describe("isIso6391Code", function () {
  it("accepts a lowercase two-letter code", function () {
    expect(isIso6391Code("de")).to.be.true;
  });

  it("is case-insensitive", function () {
    expect(isIso6391Code("DE")).to.be.true;
  });

  it("accepts a code with a region subtag", function () {
    expect(isIso6391Code("en-US")).to.be.true;
  });

  it("rejects a spelled-out language name", function () {
    expect(isIso6391Code("German")).to.be.false;
  });

  it("rejects an empty string", function () {
    expect(isIso6391Code("")).to.be.false;
  });

  it("rejects an unrecognized two-letter string", function () {
    expect(isIso6391Code("zz")).to.be.false;
  });
});
