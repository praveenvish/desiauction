# @desiauction/core

Pure domain logic: money math, clock contract, and (from IP-4) the auction reducer and invariants. Zero IO, zero framework, zero environment access — time is injected via `Clock`, `process`/`fetch`/`Date.now` are lint errors here. Tests need no infrastructure. (IP-0_DESIGN §7–§8.)
