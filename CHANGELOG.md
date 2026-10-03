# [1.2.0](https://github.com/cboulanger/zotero-language-categorizer/compare/v1.1.0...v1.2.0) (2026-10-03)


### Bug Fixes

* defer the inline code editor's focus to beat the table's own refocus ([b08cdef](https://github.com/cboulanger/zotero-language-categorizer/commit/b08cdef2a7378a6f49388b3d45d16726d7255dd1))
* normalize manually-edited codes to their primary subtag ([6627ef1](https://github.com/cboulanger/zotero-language-categorizer/commit/6627ef10bfd086bd26f016e46263f91d4f3b28a6))
* prevent Escape from committing via re-entrant blur on input removal ([ecd1276](https://github.com/cboulanger/zotero-language-categorizer/commit/ecd127684638b5262142841a9454843ed4548c84))
* show progress popup immediately when scanning for eligible items ([932591d](https://github.com/cboulanger/zotero-language-categorizer/commit/932591d5b57329431d4cef187a21fba84b6cce2d))
* **test:** update getEligibleItems test for the new eligibility rule ([1e0bea9](https://github.com/cboulanger/zotero-language-categorizer/commit/1e0bea9151a1e2d5bed4258a5b49196095d32cc9))


### Features

* default-exclude low-confidence predictions, add manual code-commit validation ([5b3fe08](https://github.com/cboulanger/zotero-language-categorizer/commit/5b3fe08949a019dd5b8e8a4b64aeaff24ca3d829))
* **dialog:** overwrite existing data and convert legacy codes ([18eba12](https://github.com/cboulanger/zotero-language-categorizer/commit/18eba1282102e1dd26d01eb555f2343a5552eaff))
* **i18n:** add confirm/edit locale strings and editor styling ([ea812f1](https://github.com/cboulanger/zotero-language-categorizer/commit/ea812f14f6ef6fdf1e7febb012716281692e65a7))
* let Cancel abort scanning, classifying, and applying ([878e24c](https://github.com/cboulanger/zotero-language-categorizer/commit/878e24cb154357706ef0f693ed38ff8fcb8adf0c))
* show progress popup while applying language changes ([a54805e](https://github.com/cboulanger/zotero-language-categorizer/commit/a54805eade3b67de361110a817a8ffa292636f2e))
* split Current/Predicted columns, add inline code editor with confirm-on-edit ([458cb24](https://github.com/cboulanger/zotero-language-categorizer/commit/458cb24b7b010abfe2ea13289723dcc01e3e2592))

# [1.1.0](https://github.com/cboulanger/zotero-language-categorizer/compare/v1.0.0...v1.1.0) (2026-10-02)


### Bug Fixes

* don't invalidate the classify table tree before it finishes mounting ([847598d](https://github.com/cboulanger/zotero-language-categorizer/commit/847598d31430ec9d6502696c7f9090f59bd55990))
* exclude CHANGELOG.md from prettier formatting ([#7](https://github.com/cboulanger/zotero-language-categorizer/issues/7)) ([4df307d](https://github.com/cboulanger/zotero-language-categorizer/commit/4df307d6966a3357c501ef5f28c11b0afdd2ab4a))
* grey out excluded rows without the yellow highlight background ([c0103f3](https://github.com/cboulanger/zotero-language-categorizer/commit/c0103f321f93b97181dd0af6eaa1250861ff4d58))
* use admin PAT for semantic-release to bypass branch protection ([#6](https://github.com/cboulanger/zotero-language-categorizer/issues/6)) ([543ca48](https://github.com/cboulanger/zotero-language-categorizer/commit/543ca48d6126f6e03729d5a20cced0a772996ba1))


### Features

* **i18n:** add classify-progress popup locale strings ([bca9518](https://github.com/cboulanger/zotero-language-categorizer/commit/bca9518b37c089577f74ec197594147ef2b3240e))
* let users exclude a row from Apply by double-clicking it ([d1ec40f](https://github.com/cboulanger/zotero-language-categorizer/commit/d1ec40f37d2a8843977ae4d8730f209b947ea055))
* show progress popup while classifying items ([bcf96ee](https://github.com/cboulanger/zotero-language-categorizer/commit/bcf96eeab0ee925bb937aa4b5b28db3f6d9978ff))

# 1.0.0 (2026-10-02)


### Bug Fixes

* sync package-lock.json with package.json ([ef1e0af](https://github.com/cboulanger/zotero-language-categorizer/commit/ef1e0afacd7538324303516d91c247333088d625))


### Features

* first public release of the language classification plugin ([fab922d](https://github.com/cboulanger/zotero-language-categorizer/commit/fab922d9801ae37c668d3e4bed0fbbfb35d8c078))
