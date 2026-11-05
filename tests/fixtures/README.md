# Legacy XLS fixture

`legacy-formulas.xls` is synthetic BIFF8 data generated independently with
`xlwt==1.3.0` by `generate-xls.py`. It includes a Chinese worksheet and strings,
a real BIFF formula record, a date, a boolean and an empty sheet. The formula has
no calculated cached result; comparison never runs Excel formulas.

The checked-in binary is sufficient for `npm test`; Python is only needed to
regenerate it. Application packages do not include these fixtures or xlwt.
