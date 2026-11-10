const URL = "https://docs.qq.com/openapi/mcp";
const TOKEN = "b0529a2f2599474aa265d522781c9c2b";
const FILE_ID = "ZwdtMfMVMIKi";
const SHEET_ID = "BB08J2";

async function findNextEmptyRow() {
  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: "sheet.get_cell_data",
      arguments: {
        file_id: FILE_ID,
        sheet_id: SHEET_ID,
        start_row: 0,
        end_row: 50,
        start_col: 0,
        end_col: 0
      }
    }
  };

  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": TOKEN
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  const resultText = data?.result?.content?.[0]?.text;
  if (!resultText) return 1;

  const parsed = JSON.parse(resultText);
  // parsed.data 通常是单元格数组
  const cells = parsed.data || [];
  let maxRow = 0;
  for (const c of cells) {
    if (c.row >= maxRow && (c.string_value || c.text)) {
      maxRow = c.row + 1;
    }
  }
  return maxRow > 0 ? maxRow : 1;
}

const nextRow = await findNextEmptyRow();
console.log("Next empty row index:", nextRow);
