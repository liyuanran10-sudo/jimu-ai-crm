import { routeAgentIntent } from "./router.js";
import { resolveAgentPolicy } from "./policy.js";
import { resolveAgentTools } from "./tools/registry.js";

export function buildAgentDecision({ body = {}, db = {}, user = null } = {}) {
  const routing = routeAgentIntent({ body, db });
  const policy = resolveAgentPolicy({ body, routing, user });
  const tools = resolveAgentTools({ routing, policy });

  return {
    version: "agent-runtime-v1",
    routing,
    policy,
    tools,
    trace: {
      router: {
        intent: routing.intent,
        confidence: routing.confidence,
        candidates: routing.candidates
      },
      policy: {
        executionMode: policy.executionMode,
        responseMode: policy.responseMode,
        guardrails: policy.guardrails,
        reason: policy.reason
      },
      scheduler: {
        tools: tools.map((tool) => ({
          name: tool.name,
          mode: tool.mode,
          status: tool.status,
          category: tool.category
        }))
      }
    }
  };
}

export function mergeAgentDecisionIntoProcessPlan(processPlan = {}, agentDecision = {}) {
  return {
    ...processPlan,
    agentDecision,
    metadata: {
      ...(processPlan.metadata || {}),
      agent_runtime: agentDecision.version || "agent-runtime-v1",
      agent_intent: agentDecision.routing?.intent || "",
      agent_intent_label: agentDecision.routing?.label || "",
      agent_confidence: agentDecision.routing?.confidence || 0,
      agent_execution_mode: agentDecision.policy?.executionMode || "",
      agent_response_mode: agentDecision.policy?.responseMode || "",
      agent_tools: (agentDecision.tools || []).map((tool) => tool.name)
    }
  };
}
