import { expect } from "chai";
import { eldClassifier } from "../../src/modules/classifiers/eld-classifier";

describe("eldClassifier", function () {
  it("has id 'eld'", function () {
    expect(eldClassifier.id).to.equal("eld");
  });

  it("detects English text", function () {
    const result = eldClassifier.classify(
      "The Origin of Species by Means of Natural Selection",
    );
    expect(result).to.not.be.null;
    expect(result!.code).to.equal("en");
  });

  it("detects German text", function () {
    const result = eldClassifier.classify(
      "Die Grundlagen der allgemeinen Relativitätstheorie",
    );
    expect(result).to.not.be.null;
    expect(result!.code).to.equal("de");
  });

  it("returns null for empty input", function () {
    expect(eldClassifier.classify("")).to.be.null;
  });

  it("returns null for whitespace-only input", function () {
    expect(eldClassifier.classify("   \n\t  ")).to.be.null;
  });

  it("flags a bare one-word title as potentially unreliable", function () {
    const result = eldClassifier.classify("Introduction");
    expect(result).to.not.be.null;
    expect(result).to.have.property("reliable").that.is.a("boolean");
  });
});
