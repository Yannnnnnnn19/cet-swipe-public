# Third-party data notices

## ECDICT

CET Swipe uses selected lexical fields from the ECDICT project by Linwei / skywind3000.

Source: https://github.com/skywind3000/ECDICT

ECDICT is distributed under the MIT License. Its license notice must be preserved when substantial portions are redistributed.

Fields currently used by the build pipeline:
- phonetic
- translation
- pos
- collins
- oxford
- tag
- bnc
- frq
- exchange

The full 62+ MB ECDICT source CSV is not committed into this repository. The build script downloads it into a local cache and emits only the CET subset needed by the app.

## CET official vocabulary source

The official vocabulary universe is extracted from the user-supplied
《全国大学英语四、六级考试大纲（2016年修订版）》.

The source PDF itself is not committed to this repository. The generated CET subset keeps source page provenance so entries can be audited against the original document.
