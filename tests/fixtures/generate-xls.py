"""Run with xlwt==1.3.0 to regenerate the independent BIFF8 fixture."""
import datetime
from pathlib import Path
import xlwt

book = xlwt.Workbook(encoding="utf-8")
sheet = book.add_sheet("数据")
for col, text in enumerate(["ID", "名称", "合计", "日期", "启用"]):
    sheet.write(0, col, text)
sheet.write(1, 0, 1)
sheet.write(1, 1, "中文产品")
sheet.write(1, 2, xlwt.Formula("1+2"))
sheet.write(1, 3, datetime.datetime(2024, 1, 2), xlwt.easyxf(num_format_str="yyyy-mm-dd"))
sheet.write(1, 4, True)
sheet.write(2, 0, 2)
sheet.write(2, 1, "第二行")
sheet.write(2, 2, 5)
book.add_sheet("空表")
book.save(str(Path(__file__).with_name("legacy-formulas.xls")))
