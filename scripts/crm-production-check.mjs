import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "../src/api-routes.js";
import { getConfig, loadDotEnv } from "../src/config.js";
import { readCrmDb, writeCrmDb } from "../src/crm-store.js";

loadDotEnv(fileURLToPath(new URL("../.env", import.meta.url)));

const envConfig = getConfig();
const config = {
  ...envConfig,
  syncTarget: "local",
  notionApiKey: "",
  notionDatabaseId: "",
  notionParentPageId: "",
  feishuAppId: "",
  feishuAppSecret: "",
  feishuFolderToken: "",
  feishuWikiSpaceId: ""
};
const liveOpenAiExpected = Boolean(config.openaiApiKey);

const originalDb = await readCrmDb();
const checks = [];
const runId = Date.now().toString(36);
const employeeEmail = `prod-check-employee-${runId}@jimu.local`;
const employeeNo = `PROD-CHECK-${runId.toUpperCase()}`;
const customerName = `线上验收客户-${runId}`;

try {
  await check("health endpoint", async () => {
    const result = await request("GET", "/api/health");
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
  });

  await check("invalid login rejected", async () => {
    const result = await request("POST", "/api/crm/login", {
      email: "mango@gymoo.cn",
      password: "wrong-password"
    });
    assert.equal(result.status, 401);
  });

  const adminLogin = await check("admin login", async () => {
    const result = await request("POST", "/api/crm/login", {
      email: "mango@gymoo.cn",
      password: "admin123"
    });
    assert.equal(result.status, 200);
    assert.ok(result.body.token.includes("."));
    return result.body;
  });

  await check("forged token rejected", async () => {
    const forged = Buffer.from(`user_admin:${Date.now()}`).toString("base64url");
    const result = await request("GET", "/api/crm/bootstrap", {}, { "x-crm-token": forged });
    assert.equal(result.status, 401);
  });

  const employee = await check("admin creates employee", async () => {
    const result = await request("POST", "/api/crm/upsert", {
      collection: "users",
      item: {
        name: "线上验收员工",
        email: employeeEmail,
        employeeNo,
        department: "市场部",
        position: "销售",
        phone: "13800138000",
        password: "prod123456",
        role: "internal_user",
        status: "active"
      }
    }, auth(adminLogin.token));
    assert.equal(result.status, 200);
    assert.equal(result.body.item.email, employeeEmail);
    assert.equal(result.body.item.employeeNo, employeeNo);
    assert.equal(result.body.item.passwordHash, undefined);
    return result.body.item;
  });

  await check("duplicate employee email rejected", async () => {
    const result = await request("POST", "/api/crm/upsert", {
      collection: "users",
      item: {
        name: "重复员工",
        email: employeeEmail,
        password: "prod123456",
        role: "internal_user",
        status: "active"
      }
    }, auth(adminLogin.token));
    assert.equal(result.status, 400);
  });

  const employeeLogin = await check("employee login", async () => {
    const result = await request("POST", "/api/crm/login", {
      email: employeeEmail,
      password: "prod123456"
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.user.role, "internal_user");
    return result.body;
  });

  await check("employee can see all customers", async () => {
    const result = await request("GET", "/api/crm/bootstrap", {}, auth(employeeLogin.token));
    assert.equal(result.status, 200);
    const customerOwners = new Set(result.body.db.customers.map((item) => item.ownerId));
    assert.ok(customerOwners.has("user_admin"));
    assert.ok(customerOwners.has("user_internal"));
  });

  await check("employee cannot mutate admin settings", async () => {
    const result = await request("POST", "/api/crm/upsert", {
      collection: "models",
      item: {
        id: "model_openai",
        name: "Forbidden",
        provider: "openai",
        modelId: "gpt-5.5",
        status: "enabled"
      }
    }, auth(employeeLogin.token));
    assert.equal(result.status, 403);
  });

  const customer = await check("employee creates customer for another salesperson", async () => {
    const result = await request("POST", "/api/crm/upsert", {
      collection: "customers",
      item: {
        name: customerName,
        contactName: "赵总",
        contactWechat: "zhao-prod-check",
        source: "官网",
        customerType: "企业内部AI",
        stage: "initial_contact",
        status: "跟进中",
        ownerId: "user_admin",
        demandDescription: "客户希望先评估 AI CRM 是否能统一客户跟进、售前方案和复盘沉淀。",
        background: "客户有多个业务部门，线索来源分散。",
        estimatedAmount: 120000,
        dealProbability: "中",
        nextAction: "安排一次需求澄清会议。"
      }
    }, auth(employeeLogin.token));
    assert.equal(result.status, 200);
    assert.equal(result.body.item.ownerId, "user_admin");
    return result.body.item;
  });

  const follow = await check("create follow record", async () => {
    const result = await request("POST", "/api/crm/upsert", {
      collection: "followRecords",
      item: {
        customerId: customer.id,
        userId: employeeLogin.user.id,
        followTime: new Date().toISOString(),
        followMethod: "会议",
        stage: "demand_communication",
        content: "客户确认需要先跑通客户档案、跟进记录、销售人员归属和 AI 方案生成。",
        customerFeedback: "客户希望所有内部成员都能看客户，但销售人员需要明确显示。",
        internalJudgement: "需求真实，适合先做 MVP 演示。",
        nextAction: "输出需求分析和方案大纲。"
      }
    }, auth(employeeLogin.token));
    assert.equal(result.status, 200);
    return result.body.item;
  });

  await check("create customer file", async () => {
    const result = await request("POST", "/api/crm/upsert", {
      collection: "customerFiles",
      item: {
        customerId: customer.id,
        followRecordId: follow.id,
        fileName: "客户聊天记录摘要",
        fileType: "聊天记录",
        parsedText: "客户多次提到销售人员归属、AI 跟进策略和失败复盘。"
      }
    }, auth(employeeLogin.token));
      assert.equal(result.status, 200);
  });

  let pptOutlineRecord = null;
  await check("all AI generation types queue and complete", async () => {
    const types = ["follow_strategy", "demand_analysis", "proposal_outline", "failure_report", "follow_summary", "chat", "next_communication_question_list", "lightweight_solution", "lightweight_solution_ppt_outline"];
    for (const type of types) {
      const result = await request("POST", "/api/crm/generate", {
        type,
        customerId: customer.id,
        userId: employeeLogin.user.id,
        message: type === "chat" ? "下一步怎么推进？" : "",
        saveToCustomer: type === "chat",
        extraContext: type === "follow_summary" ? { followRecordId: follow.id } : undefined,
        modelId: "model_local"
      }, auth(employeeLogin.token));
      assert.equal(result.status, 200);
      assert.equal(result.body.record.inputContext.asyncAiJob.status, "generating");
      assert.match(result.body.generation.outputContent, /后台生成任务|帮助中心/);
      const completed = await waitForGenerationCompletion(result.body.record.id, auth(employeeLogin.token));
      assert.equal(completed.inputContext.asyncAiJob.status, "completed");
      assert.ok(String(completed.outputContent || "").length > 80);
      if (type === "next_communication_question_list") {
        assert.match(completed.outputContent || "", /本次沟通目标/);
        assert.match(completed.outputContent || "", /必须确认的核心问题/);
      }
      if (type === "lightweight_solution") {
        assert.match(completed.outputContent || "", /项目理解与产品承接/);
        assert.match(completed.outputContent || "", /按端口梳理功能结构/);
      }
      if (type === "lightweight_solution_ppt_outline") {
        pptOutlineRecord = completed;
        assert.match(completed.outputContent || "", /PPT页面结构/);
        assert.match(completed.outputContent || "", /PPT生成提示词/);
      }
    }
  });

  await check("lightweight ppt task uses ppt skill bridge", async () => {
    assert.ok(pptOutlineRecord?.id);
    const originalFetch = globalThis.fetch;
    const taskId = `task_test_${runId}`;
    globalThis.fetch = async (url, options = {}) => {
      const isCreate = String(options.method || "GET").toUpperCase() === "POST";
      return new Response(JSON.stringify({
        task: {
          id: taskId,
          status: isCreate ? "queued" : "succeeded",
          viewerUrl: `/viewer/${taskId}/index.html`,
          downloadUrl: `/api/tasks/${taskId}/download`,
          result: {
            pptxFile: "demo.pptx",
            htmlFile: "index.html"
          }
        }
      }), {
        status: isCreate ? 201 : 200,
        headers: { "content-type": "application/json" }
      });
    };
    try {
      const result = await request("POST", "/api/crm/generate-lightweight-solution-ppt", {
        outlineRecordId: pptOutlineRecord.id,
        customerId: customer.id,
        userId: employeeLogin.user.id
      }, auth(employeeLogin.token));
      assert.equal(result.status, 200);
      assert.equal(result.body.record.generationType, "lightweight_solution_ppt");
      assert.equal(result.body.record.inputContext.asyncAiJob.status, "generating");
      assert.equal(result.body.record.inputContext.pptTask.taskId, taskId);

      const completed = await waitForGenerationCompletion(result.body.record.id, auth(employeeLogin.token), 3000);
      assert.equal(completed.inputContext.asyncAiJob.status, "completed");
      assert.match(completed.outputContent || "", /PPT 已生成完成|下载 PPT 文件/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await check("model checks are explicit", async () => {
    const local = await request("POST", "/api/crm/test-model", {
      modelId: "model_local"
    }, auth(adminLogin.token));
    assert.equal(local.status, 200);
    assert.equal(local.body.result.ok, true);

    const openai = await request("POST", "/api/crm/test-model", {
      modelId: "model_openai"
    }, auth(adminLogin.token));
    assert.equal(openai.status, 200);
    if (liveOpenAiExpected) {
      assert.equal(openai.body.result.ok, true);
      assert.doesNotMatch(openai.body.result.message, /调用失败|错误摘要|未返回成功结果|API Key/);
    } else {
      assert.equal(openai.body.result.ok, false);
      assert.match(openai.body.result.message, /API Key/);
    }
  });

  await check("failure report updates customer", async () => {
    const result = await request("POST", "/api/crm/failure", {
      customerId: customer.id,
      userId: employeeLogin.user.id,
      failureTime: new Date().toISOString(),
      failureReasonType: "项目暂缓",
      failureDescription: "客户内部预算暂缓。",
      customerFinalFeedback: "先暂停，后续重新评估。",
      internalReview: "后续用轻量 MVP 重新激活。",
      generateReport: true
    }, auth(employeeLogin.token));
    assert.equal(result.status, 200);
    assert.equal(result.body.customer.status, "失败");
    assert.ok(result.body.generation.outputContent.includes("失败"));
  });

  await check("admin deletes customer cascade", async () => {
    const result = await request("POST", "/api/crm/delete", {
      collection: "customers",
      id: customer.id
    }, auth(adminLogin.token));
    assert.equal(result.status, 200);
    assert.equal(result.body.deleted, true);

    const db = await request("GET", "/api/crm/bootstrap", {}, auth(adminLogin.token));
    assert.equal(db.body.db.followRecords.some((item) => item.customerId === customer.id), false);
    assert.equal(db.body.db.failureReports.some((item) => item.customerId === customer.id), false);
    assert.equal(db.body.db.aiGenerationRecords.some((item) => item.customerId === customer.id), false);
  });

  await check("bad route returns null for caller", async () => {
    const result = await request("GET", "/api/crm/not-found", {}, auth(adminLogin.token));
    assert.equal(result, null);
  });

  console.log(`Production CRM check passed (${checks.length} scenarios).`);
  for (const item of checks) console.log(`- ${item}`);
} finally {
  await writeCrmDb(originalDb);
}

async function check(name, fn) {
  const result = await fn();
  checks.push(name);
  return result;
}

function auth(token) {
  return { "x-crm-token": token };
}

async function request(method, pathname, body = {}, headers = {}) {
  return handleApiRequest({ method, pathname, body, headers, config });
}

async function waitForGenerationCompletion(recordId, headers, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let record = null;
  while (Date.now() < deadline) {
    const result = await request("GET", "/api/crm/bootstrap", {}, headers);
    record = result.body.db.aiGenerationRecords.find((item) => item.id === recordId);
    if (record?.inputContext?.asyncAiJob?.status !== "generating") return record;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return record;
}
