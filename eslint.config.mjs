// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";
import globals from "globals";

export default zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        // We disable this rule here because the template
        // contains some unused examples and variables
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
    {
      // Release tooling run by Node (semantic-release's exec plugin, npm
      // scripts), not part of the plugin bundle — Gecko/chrome globals
      // don't apply here, Node's do.
      files: ["scripts/**/*.mjs"],
      languageOptions: {
        globals: globals.node,
      },
    },
  ],
});
