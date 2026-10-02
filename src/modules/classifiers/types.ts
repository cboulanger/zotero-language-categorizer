export interface ClassificationResult {
  code: string; // ISO 639-1 language code
  reliable: boolean;
}

export interface LanguageClassifier {
  id: string;
  classify(text: string): ClassificationResult | null; // null = no usable prediction
}
