import { expect } from "chai";
import { eldClassifier } from "../../src/modules/classifiers/eld-classifier";

describe("eldClassifier", () => {
  it("has id 'eld'", () => {
    expect(eldClassifier.id).to.equal("eld");
  });

  it("detects English text", () => {
    const result = eldClassifier.classify(
      "The Origin of Species by Means of Natural Selection",
    );
    expect(result).to.not.be.null;
    expect(result!.code).to.equal("en");
  });

  it("detects German text", () => {
    const result = eldClassifier.classify(
      "Die Grundlagen der allgemeinen Relativitätstheorie",
    );
    expect(result).to.not.be.null;
    expect(result!.code).to.equal("de");
  });

  it("returns null for empty input", () => {
    expect(eldClassifier.classify("")).to.be.null;
  });

  it("returns null for whitespace-only input", () => {
    expect(eldClassifier.classify("   \n\t  ")).to.be.null;
  });

  it("flags a bare one-word title as potentially unreliable", () => {
    const result = eldClassifier.classify("Introduction");
    expect(result).to.not.be.null;
    expect(result).to.have.property("reliable").that.is.a("boolean");
  });
});
