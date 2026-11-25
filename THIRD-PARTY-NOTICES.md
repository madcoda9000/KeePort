# Third-party notices

KeePort includes the following data from other projects. The npm and NuGet packages KeePort depends on are listed in
`web/vault/package.json`, `web/admin/package.json` and `src/KeePort.Api/KeePort.Api.csproj` and are under their own
licenses.

## EFF Large Wordlist

- **Used for:** passphrases in the web vault's password generator (`web/vault/src/lib/wordlists/eff-large.ts`)
- **Source:** <https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt>, described at
  <https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases>
- **Author:** Electronic Frontier Foundation
- **License:** [Creative Commons Attribution 3.0 United States (CC BY 3.0 US)](https://creativecommons.org/licenses/by/3.0/us/)
- **Changes:** the dice numbers were removed; the words are unchanged.

## SecLists – common passwords

- **Used for:** recognizing common passwords in the web vault's security report
  (`web/vault/src/lib/wordlists/common-passwords.ts`)
- **Source:** `Passwords/Common-Credentials/10k-most-common.txt` from <https://github.com/danielmiessler/SecLists>, commit
  `fcde9140df96`
- **Changes:** only the first 1000 entries are used, in lower case.
- **License:** MIT

```text
MIT License

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
