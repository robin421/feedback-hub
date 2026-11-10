import urllib from "node:https";

const URL = "https://docs.qq.com/openapi/mcp";
const TOKEN = "b0529a2f2599474aa265d522781c9c2b";
const FILE_ID = "ZwdtMfMVMIKi";
const SHEET_ID = "BB08J2";

async function appendRowToTencentSheet({
  timeStr,
  pkg,
  category,
  severity,
  summary,
  content,
  translation,
  email,
  ver,
  os,
  extra
}) {
  // 1. 获取当前表信息以确定下一行位置
  const getInfoPayload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: "sheet.get_sheet_info",
      arguments: { file_id: FILE_ID }
    }
  };

  const infoRes = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": TOKEN
    },
    body: JSON.stringify(getInfoPayload)
  });

  const infoData = await infoRes.json();
  const sheets = infoData?.result?.content?.[0]?.text ? JSON.parse(infoData.result.content[0].text).sheets : [];
  const currentSheet = sheets.find(s => s.sheet_id === SHEET_ID) || sheets[0];
  
  // 简单基于行数推算，或直接往下方追加
  // 我们也可以通过 sheet.get_cell_data 或维护行号
  console.log("Sheet Info:", currentSheet?.sheet_name, "RowCount:", currentSheet?.row_count);
}

appendRowToTencentSheet({
  timeStr: "2026-11-10 23:08",
  pkg: "FitFlow",
  category: "功能建议",
  severity: "LOW",
  summary: "训练计划支持自选周循环",
  content: "希望能自定义训练周的休息日安排",
  translation: "希望能自定义训练周的休息日安排",
  email: "fit@example.com",
  ver: "2.0.0",
  os: "iOS 18",
  extra: "{}"
});
