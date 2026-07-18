import express from "express";
import { query, unstable_v2_createSession, unstable_v2_authenticate, PermissionResult, CanUseTool } from "@tencent-ai/agent-sdk";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import * as db from "./db.js";
import * as automation from "./automation.js";

const execAsync = promisify(exec);

// 待处理的权限请求
interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  timestamp: number;
}

const pendingPermissions = new Map<string, PendingPermission>();

// 权限请求超时时间（5分钟）
const PERMISSION_TIMEOUT = 5 * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// 缓存可用模型列表
let cachedModels: Array<{ modelId: string; name: string; description?: string }> = [];
const defaultModel = "claude-sonnet-4";

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 登录方式类型
type LoginMethod = 'env' | 'cli' | 'none';

interface LoginStatusResponse {
  isLoggedIn: boolean;
  method?: LoginMethod;
  envConfigured?: boolean;
  cliConfigured?: boolean;
  error?: string;
  apiKey?: string; // 脱敏后的 API Key
  envVars?: {
    apiKey?: string;
    authToken?: string;
    internetEnv?: string;
    baseUrl?: string;
  };
}

// 检查 CodeBuddy CLI 登录状态
app.get("/api/check-login", async (req, res) => {
  const response: LoginStatusResponse = {
    isLoggedIn: false,
    envConfigured: false,
    cliConfigured: false,
    envVars: {},
  };
  
  // 1. 检查环境变量
  const apiKey = process.env.CODEBUDDY_API_KEY;
  const authToken = process.env.CODEBUDDY_AUTH_TOKEN;
  const internetEnv = process.env.CODEBUDDY_INTERNET_ENVIRONMENT;
  const baseUrl = process.env.CODEBUDDY_BASE_URL;
  
  if (apiKey || authToken) {
    response.envConfigured = true;
    // 脱敏显示
    if (apiKey) {
      response.envVars!.apiKey = apiKey.slice(0, 8) + '****' + apiKey.slice(-4);
      response.apiKey = response.envVars!.apiKey;
    }
    if (authToken) {
      response.envVars!.authToken = authToken.slice(0, 8) + '****' + authToken.slice(-4);
    }
    if (internetEnv) {
      response.envVars!.internetEnv = internetEnv;
    }
    if (baseUrl) {
      response.envVars!.baseUrl = baseUrl;
    }
  }
  
  // 2. 使用 unstable_v2_authenticate 检查登录状态（更可靠）
  try {
    let needsLogin = false;
    
    const result = await unstable_v2_authenticate({
      environment: 'external',
      onAuthUrl: async (authState) => {
        // 如果执行到这个回调，说明未登录
        needsLogin = true;
        console.log('[Check Login] 需要登录，认证 URL:', authState.authUrl);
        // 将认证 URL 返回给前端（如果需要）
        response.error = '未登录，请先登录 CodeBuddy CLI';
      }
    });
    
    // 如果没有触发 onAuthUrl 回调，说明已登录
    if (!needsLogin && result?.userinfo) {
      response.isLoggedIn = true;
      response.cliConfigured = true;
      
      // 判断登录方式
      if (response.envConfigured) {
        response.method = 'env';
      } else {
        response.method = 'cli';
      }
      
      console.log('[Check Login] 已登录用户:', result.userinfo.userName);
    } else if (!needsLogin) {
      // result 存在但没有 userinfo，仍然认为已登录
      response.isLoggedIn = true;
      response.cliConfigured = true;
      response.method = response.envConfigured ? 'env' : 'cli';
    }
  } catch (error: any) {
    console.error("[Check Login] SDK Error:", error);
    
    // 如果有环境变量配置，仍然认为是登录状态
    if (response.envConfigured) {
      response.isLoggedIn = true;
      response.method = 'env';
    } else {
      response.error = error?.message || String(error);
      response.method = 'none';
    }
  }
  
  res.json(response);
});

// 保存环境变量配置
app.post("/api/save-env-config", (req, res) => {
  const { apiKey, authToken, internetEnv, baseUrl } = req.body;
  
  if (!apiKey && !authToken) {
    return res.status(400).json({ error: '请至少配置 API Key 或 Auth Token' });
  }
  
  const configuredVars: string[] = [];
  
  // 设置环境变量（仅在当前进程有效）
  if (apiKey) {
    process.env.CODEBUDDY_API_KEY = apiKey;
    configuredVars.push('CODEBUDDY_API_KEY');
  }
  if (authToken) {
    process.env.CODEBUDDY_AUTH_TOKEN = authToken;
    configuredVars.push('CODEBUDDY_AUTH_TOKEN');
  }
  if (internetEnv) {
    process.env.CODEBUDDY_INTERNET_ENVIRONMENT = internetEnv;
    configuredVars.push('CODEBUDDY_INTERNET_ENVIRONMENT');
  }
  if (baseUrl) {
    process.env.CODEBUDDY_BASE_URL = baseUrl;
    configuredVars.push('CODEBUDDY_BASE_URL');
  }
  
  // 清除模型缓存，以便重新获取
  cachedModels = [];
  
  res.json({ 
    success: true, 
    message: `已设置: ${configuredVars.join(', ')}`,
    note: '环境变量仅在当前服务器进程有效，重启后需要重新设置'
  });
});

// 获取可用模型列表
app.get("/api/models", async (req, res) => {
  try {
    if (cachedModels.length === 0) {
      console.log("[Models] Creating session to fetch available models...");
      
      const session = await unstable_v2_createSession({ 
        cwd: process.cwd()
      });
      
      console.log("[Models] Session created, calling getAvailableModels()...");
      const models = await session.getAvailableModels();
      console.log("[Models] Got", models.length, "models");
      
      if (models && Array.isArray(models)) {
        cachedModels = models;
      }
    }
    
    res.json({ 
      models: cachedModels.length > 0 ? cachedModels : [
        { modelId: "claude-sonnet-4", name: "Claude Sonnet 4" }
      ],
      defaultModel 
    });
  } catch (error: any) {
    console.error("[Models] Error:", error);
    res.json({
      models: [
        { modelId: "claude-sonnet-4", name: "Claude Sonnet 4" },
        { modelId: "claude-opus-4", name: "Claude Opus 4" }
      ],
      defaultModel,
      error: error?.message || String(error)
    });
  }
});

// ============= 会话 API =============

// 获取所有会话（包含消息数量）
app.get("/api/sessions", (req, res) => {
  try {
    const sessions = db.getAllSessions();
    const sessionsWithMessages = sessions.map(session => {
      const messages = db.getMessagesBySession(session.id);
      return {
        ...session,
        messageCount: messages.length
      };
    });
    res.json({ sessions: sessionsWithMessages });
  } catch (error: any) {
    console.error("[Sessions] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 获取单个会话及其消息
app.get("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    const messages = db.getMessagesBySession(sessionId);
    
    // 解析 tool_calls JSON
    const parsedMessages = messages.map(msg => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null
    }));
    
    res.json({ session, messages: parsedMessages });
  } catch (error: any) {
    console.error("[Session] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 创建新会话
app.post("/api/sessions", (req, res) => {
  try {
    const { model = defaultModel, title = "新对话" } = req.body;
    const now = new Date().toISOString();
    
    const session = db.createSession({
      id: uuidv4(),
      title,
      model,
      created_at: now,
      updated_at: now
    });
    
    res.json({ session });
  } catch (error: any) {
    console.error("[Create Session] Error:", error);
    res.status(500).json({ error: error?.message || "创建会话失败" });
  }
});

// 更新会话
app.patch("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, model } = req.body;
    
    const success = db.updateSession(sessionId, { title, model });
    
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Update Session] Error:", error);
    res.status(500).json({ error: error?.message || "更新会话失败" });
  }
});

// 删除会话
app.delete("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const success = db.deleteSession(sessionId);
    
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Delete Session] Error:", error);
    res.status(500).json({ error: error?.message || "删除会话失败" });
  }
});

// ============= 聊天 API =============

// 权限响应 API
app.post("/api/permission-response", (req, res) => {
  const { requestId, behavior, message } = req.body;
  
  console.log(`[Permission] Response received: requestId=${requestId}, behavior=${behavior}`);
  
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    console.log(`[Permission] Request not found: ${requestId}`);
    return res.status(404).json({ error: "权限请求不存在或已超时" });
  }
  
  // 清除请求
  pendingPermissions.delete(requestId);
  
  if (behavior === 'allow') {
    pending.resolve({
      behavior: 'allow',
      updatedInput: pending.input
    });
  } else {
    pending.resolve({
      behavior: 'deny',
      message: message || '用户拒绝了此操作'
    });
  }
  
  res.json({ success: true });
});

// 发送消息并获取流式响应
app.post("/api/chat", async (req, res) => {
  const { sessionId, message, model, systemPrompt, cwd, permissionMode } = req.body;
  
  // 请求日志
  console.log(`\n[Chat] ========== 新请求 ==========`);
  console.log(`[Chat] SessionId: ${sessionId}`);
  console.log(`[Chat] Model: ${model}`);
  console.log(`[Chat] Message: ${message?.slice(0, 100)}${message?.length > 100 ? '...' : ''}`);
  console.log(`[Chat] CWD: ${cwd || 'default'}`);

  if (!message) {
    console.log(`[Chat] 错误: 消息为空`);
    return res.status(400).json({ error: "消息不能为空" });
  }

  // 获取或创建会话
  let session = sessionId ? db.getSession(sessionId) : null;
  const now = new Date().toISOString();
  
  if (!session) {
    // 创建新会话
    console.log(`[Chat] 创建新会话`);
    session = db.createSession({
      id: sessionId || uuidv4(),
      title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
      model: model || defaultModel,
      sdk_session_id: null,  // 稍后从 SDK 获取
      created_at: now,
      updated_at: now
    });
  } else {
    console.log(`[Chat] 使用现有会话, SDK Session: ${session.sdk_session_id || 'none'}`);
  }

  const selectedModel = model || session.model;
  
  // 获取 SDK session ID（用于恢复对话）
  const sdkSessionId = session.sdk_session_id;

  // 创建用户消息 ID 和助手消息 ID
  const userMessageId = uuidv4();
  const assistantMessageId = uuidv4();

  // 保存用户消息到数据库
  try {
    db.createMessage({
      id: userMessageId,
      session_id: session.id,
      role: 'user',
      content: message,
      model: null,
      created_at: now,
      tool_calls: null
    });
    console.log(`[Chat] 用户消息已保存: ${userMessageId}`);
  } catch (dbError: any) {
    console.error(`[Chat] 保存用户消息失败:`, dbError);
    return res.status(500).json({ error: "保存消息失败", detail: dbError?.message });
  }

  // 设置 SSE 头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // 默认系统提示词
  const defaultSystemPrompt = "你是智聘通，一个专业的招聘流程自动化助手。你的职责是帮助 HR 实现招聘数据自动化记录、实时同步更新和数据可视化。当用户发送候选人信息或面试安排时，请自动解析并结构化数据，维护 candidates.json 和 interviews.json 文件，并主动提醒下一步操作。请用简洁清晰的中文回复。";
  
  // 工作目录：优先使用请求中的 cwd，否则使用当前目录
  const workingDir = cwd || process.cwd();

  try {
    console.log(`[Chat] 调用 SDK query...`);
    console.log(`[Chat] - Model: ${selectedModel}`);
    console.log(`[Chat] - Resume: ${sdkSessionId || 'none'}`);
    console.log(`[Chat] - CWD: ${workingDir}`);
    console.log(`[Chat] - PermissionMode: ${permissionMode || 'default'}`);
    
    // 创建 canUseTool 回调
    const canUseTool: CanUseTool = async (toolName, input, options) => {
      console.log(`[Permission] Tool request: ${toolName}`);
      console.log(`[Permission] Input:`, JSON.stringify(input, null, 2));
      
      // bypassPermissions 模式直接放行
      if (permissionMode === 'bypassPermissions') {
        console.log(`[Permission] Bypassing permissions for ${toolName}`);
        return { behavior: 'allow', updatedInput: input };
      }
      
      // 创建权限请求
      const requestId = uuidv4();
      const permissionRequest = {
        requestId,
        toolUseId: options.toolUseID,
        toolName,
        input,
        sessionId: session.id,
        timestamp: Date.now()
      };
      
      // 发送权限请求到前端
      res.write(`data: ${JSON.stringify({ 
        type: "permission_request", 
        ...permissionRequest
      })}\n\n`);
      
      // 创建 Promise 等待用户响应
      return new Promise<PermissionResult>((resolve, reject) => {
        const pending: PendingPermission = {
          resolve,
          reject,
          toolName,
          input,
          sessionId: session.id,
          timestamp: Date.now()
        };
        
        pendingPermissions.set(requestId, pending);
        
        // 设置超时
        setTimeout(() => {
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId);
            console.log(`[Permission] Request timeout: ${requestId}`);
            resolve({
              behavior: 'deny',
              message: '权限请求超时'
            });
          }
        }, PERMISSION_TIMEOUT);
      });
    };
    
    // 使用 Query API 发送消息
    // 如果有 sdk_session_id，使用 resume 恢复对话上下文
    const stream = query({
      prompt: message,
      options: {
        cwd: workingDir,
        model: selectedModel,
        maxTurns: 10,
        systemPrompt: systemPrompt || defaultSystemPrompt,
        permissionMode: permissionMode || 'default',
        canUseTool,
        ...(sdkSessionId ? { resume: sdkSessionId } : {})  // 使用 resume 恢复对话
      }
    });

    let fullResponse = "";
    let toolCalls: Array<{ 
      id: string; 
      name: string; 
      input?: Record<string, unknown>;
      status: string; 
      result?: string;
      isError?: boolean;
    }> = [];
    let newSdkSessionId: string | null = null;  // 用于存储 SDK 返回的 session_id

    // 发送会话ID和消息ID
    res.write(`data: ${JSON.stringify({ 
      type: "init", 
      sessionId: session.id, 
      userMessageId, 
      assistantMessageId,
      model: selectedModel 
    })}\n\n`);

    // 当前正在执行的工具 ID（用于匹配 tool_result）
    let currentToolId: string | null = null;

    // 处理流式响应
    for await (const msg of stream) {
      console.log("[Stream] Message type:", msg.type, msg);
      
      // 处理 system 消息，获取 SDK 的 session_id
      if (msg.type === "system" && (msg as any).subtype === "init") {
        newSdkSessionId = (msg as any).session_id;
        console.log(`[Stream] Got SDK session_id: ${newSdkSessionId}`);
        
        // 保存 SDK session_id 到数据库（如果是新的）
        if (newSdkSessionId && newSdkSessionId !== sdkSessionId) {
          db.updateSession(session.id, { sdk_session_id: newSdkSessionId });
          console.log(`[Stream] Saved SDK session_id to database`);
        }
      } else if (msg.type === "assistant") {
        const content = msg.message.content;

        if (typeof content === "string") {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ type: "text", content })}\n\n`);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              fullResponse += block.text;
              res.write(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`);
            } else if (block.type === "tool_use") {
              currentToolId = block.id || uuidv4();
              const toolInput = (block as any).input || {};
              console.log(`[Stream] Tool use: id=${currentToolId}, name=${block.name}`);
              console.log(`[Stream] Tool input:`, JSON.stringify(toolInput, null, 2));
              
              const toolCall = { 
                id: currentToolId, 
                name: block.name, 
                input: toolInput,
                status: "running" 
              };
              toolCalls.push(toolCall);
              res.write(`data: ${JSON.stringify({ 
                type: "tool", 
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
                status: toolCall.status
              })}\n\n`);
            }
          }
        }
      } else if (msg.type === "tool_result") {
        // 处理工具结果（独立的消息类型）
        const msgAny = msg as any;
        const toolId = msgAny.tool_use_id || currentToolId;
        const isError = msgAny.is_error || false;
        const content = msgAny.content;
        
        console.log(`[Stream] Tool result: tool_use_id=${toolId}, is_error=${isError}`);
        console.log(`[Stream] Tool result content type:`, typeof content);
        console.log(`[Stream] Tool result content:`, typeof content === 'string' ? content.slice(0, 500) : JSON.stringify(content, null, 2)?.slice(0, 500));
        
        const tool = toolCalls.find(t => t.id === toolId) || toolCalls[toolCalls.length - 1];
        if (tool) {
          tool.status = isError ? "error" : "completed";
          tool.isError = isError;
          tool.result = typeof content === 'string' 
            ? content 
            : JSON.stringify(content);
          res.write(`data: ${JSON.stringify({ 
            type: "tool_result", 
            toolId: tool.id, 
            content: tool.result,
            isError: isError
          })}\n\n`);
        }
        currentToolId = null;
      } else if (msg.type === "result") {
        // 完成时确保所有工具都标记为完成
        toolCalls.forEach(tool => {
          if (tool.status === "running") {
            tool.status = "completed";
            res.write(`data: ${JSON.stringify({ type: "tool_result", toolId: tool.id, content: tool.result || "已完成" })}\n\n`);
          }
        });
        res.write(`data: ${JSON.stringify({ type: "done", duration: msg.duration, cost: msg.cost })}\n\n`);
      }
    }

    // 保存助手消息到数据库
    db.createMessage({
      id: assistantMessageId,
      session_id: session.id,
      role: 'assistant',
      content: fullResponse,
      model: selectedModel,
      created_at: new Date().toISOString(),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null
    });

    // 更新会话标题（如果是第一条消息）
    const messages = db.getMessagesBySession(session.id);
    if (messages.length <= 2) {
      db.updateSession(session.id, { 
        title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
        model: selectedModel
      });
    }

    console.log(`[Chat] 请求完成 ✓`);
    res.end();
  } catch (error: any) {
    console.error(`\n[Chat] ========== 错误 ==========`);
    console.error(`[Chat] Error Name:`, error?.name);
    console.error(`[Chat] Error Message:`, error?.message);
    console.error(`[Chat] Error Code:`, error?.code);
    console.error(`[Chat] Error Stack:`, error?.stack);
    console.error(`[Chat] Full Error:`, JSON.stringify(error, null, 2));
    
    const errorMessage = error?.message || "处理请求时发生错误";
    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
    res.end();
  }
});

// ============= 招聘候选人 API =============

// 获取所有候选人
app.get("/api/candidates", (req, res) => {
  try {
    const candidates = db.getAllCandidates();
    // 解析 JSON 字段
    const parsed = candidates.map(c => ({
      ...c,
      stage_history: c.stage_history ? JSON.parse(c.stage_history) : [],
      tags: c.tags ? JSON.parse(c.tags) : [],
      interviewers: c.interviewers ? JSON.parse(c.interviewers) : [],
    }));
    res.json({ candidates: parsed });
  } catch (error: any) {
    console.error("[Candidates] Error:", error);
    res.status(500).json({ error: error?.message || "获取候选人失败" });
  }
});

// 获取单个候选人
app.get("/api/candidates/:id", (req, res) => {
  try {
    const candidate = db.getCandidate(req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: "候选人不存在" });
    }
    const parsed = {
      ...candidate,
      stage_history: candidate.stage_history ? JSON.parse(candidate.stage_history) : [],
      tags: candidate.tags ? JSON.parse(candidate.tags) : [],
      interviewers: candidate.interviewers ? JSON.parse(candidate.interviewers) : [],
    };
    res.json({ candidate: parsed });
  } catch (error: any) {
    console.error("[Candidate] Error:", error);
    res.status(500).json({ error: error?.message || "获取候选人失败" });
  }
});

// 创建候选人
app.post("/api/candidates", (req, res) => {
  try {
    const { name, phone, email, position, source, resume_path, stage, tags, remark } = req.body;
    if (!name) {
      return res.status(400).json({ error: "候选人姓名不能为空" });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const candidate = db.createCandidate({
      id,
      name,
      phone: phone || null,
      email: email || null,
      position: position || null,
      source: source || null,
      resume_path: resume_path || null,
      stage: stage || 'resume_collection',
      stage_history: JSON.stringify([{ stage: stage || 'resume_collection', timestamp: now, note: '候选人创建' }]),
      tags: tags ? JSON.stringify(tags) : null,
      interview_time: null,
      interviewers: null,
      interview_result: null,
      retest_time: null,
      retest_result: null,
      remark: remark || null,
      created_at: now,
      updated_at: now,
    });

    res.json({ candidate });
  } catch (error: any) {
    console.error("[Create Candidate] Error:", error);
    res.status(500).json({ error: error?.message || "创建候选人失败" });
  }
});

// 更新候选人（含阶段流转）
app.patch("/api/candidates/:id", (req, res) => {
  try {
    const { id } = req.params;
    const candidate = db.getCandidate(id);
    if (!candidate) {
      return res.status(404).json({ error: "候选人不存在" });
    }

    const updates: any = { ...req.body };

    // 处理阶段流转
    if (updates.stage && updates.stage !== candidate.stage) {
      const history = candidate.stage_history ? JSON.parse(candidate.stage_history) : [];
      history.push({
        stage: updates.stage,
        timestamp: new Date().toISOString(),
        note: updates.stage_note || `从 ${candidate.stage} 流转到 ${updates.stage}`,
      });
      updates.stage_history = JSON.stringify(history);
      delete updates.stage_note;
    }

    // 处理数组字段
    if (Array.isArray(updates.tags)) {
      updates.tags = JSON.stringify(updates.tags);
    }
    if (Array.isArray(updates.interviewers)) {
      updates.interviewers = JSON.stringify(updates.interviewers);
    }

    const success = db.updateCandidate(id, updates);
    if (!success) {
      return res.status(404).json({ error: "更新失败" });
    }

    const updated = db.getCandidate(id);
    res.json({
      candidate: {
        ...updated,
        stage_history: updated?.stage_history ? JSON.parse(updated.stage_history) : [],
        tags: updated?.tags ? JSON.parse(updated.tags) : [],
        interviewers: updated?.interviewers ? JSON.parse(updated.interviewers) : [],
      }
    });
  } catch (error: any) {
    console.error("[Update Candidate] Error:", error);
    res.status(500).json({ error: error?.message || "更新候选人失败" });
  }
});

// 删除候选人
app.delete("/api/candidates/:id", (req, res) => {
  try {
    const success = db.deleteCandidate(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "候选人不存在" });
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Delete Candidate] Error:", error);
    res.status(500).json({ error: error?.message || "删除候选人失败" });
  }
});

// 按阶段获取候选人
app.get("/api/candidates/stage/:stage", (req, res) => {
  try {
    const candidates = db.getCandidatesByStage(req.params.stage);
    const parsed = candidates.map(c => ({
      ...c,
      stage_history: c.stage_history ? JSON.parse(c.stage_history) : [],
      tags: c.tags ? JSON.parse(c.tags) : [],
      interviewers: c.interviewers ? JSON.parse(c.interviewers) : [],
    }));
    res.json({ candidates: parsed });
  } catch (error: any) {
    console.error("[Candidates by Stage] Error:", error);
    res.status(500).json({ error: error?.message || "获取候选人失败" });
  }
});

// ============= 面试记录 API =============

// 获取所有面试记录
app.get("/api/interviews", (req, res) => {
  try {
    const interviews = db.getAllInterviews();
    const parsed = interviews.map(i => ({
      ...i,
      interviewers: i.interviewers ? JSON.parse(i.interviewers) : [],
    }));
    res.json({ interviews: parsed });
  } catch (error: any) {
    console.error("[Interviews] Error:", error);
    res.status(500).json({ error: error?.message || "获取面试记录失败" });
  }
});

// 创建面试记录
app.post("/api/interviews", (req, res) => {
  try {
    const { candidate_id, candidate_name, type, position, scheduled_time, duration_minutes, interviewers, location, status, result, feedback } = req.body;
    if (!candidate_id || !type) {
      return res.status(400).json({ error: "候选人ID和面试类型不能为空" });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const interview = db.createInterview({
      id,
      candidate_id,
      candidate_name: candidate_name || null,
      type,
      position: position || null,
      scheduled_time: scheduled_time || null,
      duration_minutes: duration_minutes || 60,
      interviewers: interviewers ? JSON.stringify(interviewers) : null,
      location: location || null,
      status: status || 'scheduled',
      result: result || null,
      feedback: feedback || null,
      created_at: now,
      updated_at: now,
    });

    // 同步更新候选人状态
    if (type === 'group_interview') {
      db.updateCandidate(candidate_id, {
        stage: 'interview_schedule',
        interview_time: scheduled_time || null,
        interviewers: interviewers ? JSON.stringify(interviewers) : null,
      });
    } else if (type === 'retest') {
      db.updateCandidate(candidate_id, {
        stage: 'retest_schedule',
        retest_time: scheduled_time || null,
      });
    }

    res.json({ interview });
  } catch (error: any) {
    console.error("[Create Interview] Error:", error);
    res.status(500).json({ error: error?.message || "创建面试记录失败" });
  }
});

// 更新面试记录
app.patch("/api/interviews/:id", (req, res) => {
  try {
    const updates: any = { ...req.body };
    if (Array.isArray(updates.interviewers)) {
      updates.interviewers = JSON.stringify(updates.interviewers);
    }

    const success = db.updateInterview(req.params.id, updates);
    if (!success) {
      return res.status(404).json({ error: "面试记录不存在" });
    }

    // 如果更新了结果，同步更新候选人状态
    if (updates.result && updates.candidate_id) {
      const interview = db.getInterview(req.params.id);
      if (interview) {
        if (interview.type === 'group_interview') {
          db.updateCandidate(interview.candidate_id, {
            interview_result: updates.result,
            stage: updates.result === 'passed' ? 'retest_list' : 'interview_result',
          });
        } else if (interview.type === 'retest') {
          db.updateCandidate(interview.candidate_id, {
            retest_result: updates.result,
            stage: 'retest_result',
          });
        }
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("[Update Interview] Error:", error);
    res.status(500).json({ error: error?.message || "更新面试记录失败" });
  }
});

// 删除面试记录
app.delete("/api/interviews/:id", (req, res) => {
  try {
    const success = db.deleteInterview(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "面试记录不存在" });
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Delete Interview] Error:", error);
    res.status(500).json({ error: error?.message || "删除面试记录失败" });
  }
});

// ============= 流程统计 API =============

// 获取招聘漏斗和统计数据
app.get("/api/pipeline-stats", (req, res) => {
  try {
    const stats = db.getPipelineStats();
    res.json({ stats });
  } catch (error: any) {
    console.error("[Pipeline Stats] Error:", error);
    res.status(500).json({ error: error?.message || "获取统计数据失败" });
  }
});

// 获取阶段标签映射
app.get("/api/stage-labels", (req, res) => {
  res.json({
    labels: db.getStageLabels(),
    order: db.getStageOrder(),
  });
});

// ============= 提效 Agent 自动化中枢 API =============

// SSE 实时流：首帧发快照，后续增量推送
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const snapshot = automation.getSnapshot();
  res.write(`data: ${JSON.stringify({ type: "snapshot", ...snapshot })}\n\n`);

  const unsub = automation.subscribe((payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });

  // 心跳，保活
  const ping = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
  }, 15000);

  req.on("close", () => {
    unsub();
    clearInterval(ping);
  });
});

// 获取自动化行为日志
app.get("/api/agent-logs", (req, res) => {
  try {
    const logs = db.getAgentLogs(50).reverse();
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取日志失败" });
  }
});

// 获取采集层原始事件
app.get("/api/events", (req, res) => {
  try {
    const events = db.getRecentEvents(50).reverse();
    res.json({ events });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取事件失败" });
  }
});

// 获取异常（推进慢 / 识别慢 / 信息缺失）
app.get("/api/anomalies", (req, res) => {
  try {
    res.json({ anomalies: automation.computeAnomalies() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取异常失败" });
  }
});

// 兼容性保留（旧端点别名）
app.get("/api/alerts", (req, res) => {
  try {
    res.json({ alerts: automation.computeAnomalies() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取预警失败" });
  }
});

// ============= 提效 Agent：HR 简历收集 + 腾讯文档聚合 =============

// HR 收集并上传简历 → Agent 自动聚合到腾讯文档并继续推进
app.post("/api/hr/upload-resume", (req, res) => {
  try {
    const { name, position, source, phone, email, tags, availability } = req.body || {};
    const result = automation.hrUploadResume({
      name,
      position,
      source,
      phone,
      email,
      tags,
      availability,
    });
    if (!result.ok) return res.status(400).json({ error: result.message });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "上传简历失败" });
  }
});

// 获取腾讯文档（简历汇总库快照）
app.get("/api/tencent-doc", (req, res) => {
  try {
    let doc = db.getTencentDoc();
    if (!doc) {
      automation.aggregateTencentDoc();
      doc = db.getTencentDoc();
    }
    res.json({ doc });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取腾讯文档失败" });
  }
});

// ============= 提效 Agent：AI 辅助二筛 =============

// 执行 AI 二筛（置信度分级）
app.post("/api/ai-screening", async (req, res) => {
  try {
    const { candidateId, deptRequirement } = req.body || {};
    if (!candidateId) return res.status(400).json({ error: "缺少 candidateId" });
    const result = await automation.runAIScreening(candidateId, deptRequirement);
    if (!result.ok) return res.status(400).json({ error: result.message });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "AI 二筛失败" });
  }
});

// 生成二筛专业提示词（不写库，仅预览）
app.post("/api/ai-screening-prompt", (req, res) => {
  try {
    const { candidateId, deptRequirement } = req.body || {};
    const candidate = db.getCandidate(candidateId);
    if (!candidate) return res.status(404).json({ error: "候选人不存在" });
    const profile = undefined;
    const requirement = deptRequirement || defaultRequirementFallback(candidate);
    res.json({ prompt: automation.buildScreeningPrompt(candidate, requirement), requirement });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "生成提示词失败" });
  }
});

// 获取二筛记录
app.get("/api/screening-records", (req, res) => {
  try {
    res.json({ records: db.getScreeningRecords(50) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取二筛记录失败" });
  }
});

// ============= 提效 Agent：AI 初筛（首轮筛选） =============

// 执行 AI 初筛（首轮置信度分级）
app.post("/api/ai-initial-screening", async (req, res) => {
  try {
    const { candidateId, requirement } = req.body || {};
    if (!candidateId) return res.status(400).json({ error: "缺少 candidateId" });
    const result = await automation.runAIInitialScreening(candidateId, requirement);
    if (!result.ok) return res.status(400).json({ error: result.message });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "AI 初筛失败" });
  }
});

// 生成初筛专业提示词（不写库，仅预览）
app.post("/api/ai-initial-screening-prompt", (req, res) => {
  try {
    const { candidateId, requirement } = req.body || {};
    const candidate = db.getCandidate(candidateId);
    if (!candidate) return res.status(404).json({ error: "候选人不存在" });
    const req2 = requirement || defaultRequirementFallback(candidate);
    res.json({ prompt: automation.buildInitialScreeningPrompt(candidate, req2), requirement: req2 });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "生成提示词失败" });
  }
});

// ============= 提效 Agent：约面排期 =============

// 获取面试官与可约时间
app.get("/api/interviewers", (req, res) => {
  try {
    res.json({ interviewers: db.getAllInterviewers() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取面试官失败" });
  }
});

// 更新面试官可约时间
app.post("/api/interviewers", (req, res) => {
  try {
    const { id, name, dept, role, available_slots } = req.body || {};
    if (!name) return res.status(400).json({ error: "面试官姓名不能为空" });
    const rec = db.upsertInterviewer({ id, name, dept, role, available_slots: available_slots || [] });
    res.json({ interviewer: rec });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "保存面试官失败" });
  }
});

// 执行约面排期（面试官 / 求职者时间匹配）
app.post("/api/schedule-interview", (req, res) => {
  try {
    const { candidateId, type, interviewerId } = req.body || {};
    if (!candidateId || !type) return res.status(400).json({ error: "缺少 candidateId 或 type" });
    const result = automation.runScheduling(candidateId, type, interviewerId);
    if (!result.ok) return res.status(400).json({ error: result.message, schedule: result.schedule });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "约面排期失败" });
  }
});

// 获取面试排期表
app.get("/api/schedule", (req, res) => {
  try {
    const interviews = db.getAllInterviews().map((i) => ({ ...i, interviewers: i.interviewers ? JSON.parse(i.interviewers) : [] }));
    res.json({ interviews });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取排期失败" });
  }
});

// 默认部门需求（供提示词生成兜底）
function defaultRequirementFallback(candidate: any): string {
  const map: Record<string, string> = {
    前端工程师: '具备 React / TypeScript 3 年以上经验，熟悉可视化与性能优化，有大型项目经验优先',
    后端工程师: '精通 Go / Java 服务端开发，熟悉微服务与高并发架构，有分布式经验优先',
    Java工程师: '精通 SpringCloud 微服务，熟悉高并发与分布式事务，有大流量系统经验优先',
    测试工程师: '掌握自动化测试与性能压测，熟悉接口测试框架，有 CI/CD 经验优先',
    UI设计师: '熟练使用 Figma，具备交互设计能力，有 B 端 / C 端设计经验优先',
    数据分析师: '精通 SQL 与 Python，熟悉指标体系搭建与数据建模，有业务分析经验优先',
    算法工程师: '掌握 NLP 与深度学习，熟悉主流训练框架，有落地项目优先',
    产品经理: '具备 B 端 / C 端产品规划能力，数据驱动，有 0-1 经验优先',
    运营专员: '具备社群运营与内容策划能力，有增长活动经验优先',
    HRBP: '熟悉组织发展与招聘全流程，具备沟通协调与数据分析能力优先',
  };
  return map[candidate.position || ''] || `${candidate.position || '该'}岗位，具备相关经验与专业能力，沟通协作良好，有团队项目经验优先`;
}

// 自动化引擎控制（start / stop / reset）
app.post("/api/automation/control", (req, res) => {
  const { action } = req.body || {};
  try {
    if (action === "start") automation.startAutomation();
    else if (action === "stop") automation.stopAutomation();
    else if (action === "reset") automation.resetAutomation();
    else return res.status(400).json({ error: "未知操作" });
    res.json({ ok: true, status: automation.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "操作失败" });
  }
});

// 自动化引擎状态
app.get("/api/automation/status", (req, res) => {
  res.json(automation.getStatus());
});

// 轻量干预：HR 兜底指令（推进 / 驳回）
app.post("/api/intervention", (req, res) => {
  const { command } = req.body || {};
  if (!command || !command.trim()) {
    return res.status(400).json({ error: "干预指令不能为空" });
  }
  try {
    const result = automation.runIntervention(command.trim());
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "干预执行失败" });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║     ◉ 智聘通 · 招聘提效 Agent 已启动        ║
║                                            ║
║     地址: http://localhost:${PORT}            ║
║     数据库: SQLite (data/chat.db)          ║
║     招聘API: /api/candidates               ║
║             /api/pipeline-stats            ║
║     自动化:  /api/stream (SSE)             ║
║             /api/automation/control        ║
║             /api/intervention              ║
║                                            ║
╚════════════════════════════════════════════╝
  `);

  // 自动启动提效 Agent：监听模拟招聘事件流，自动采集→录入→同步看板
  automation.startAutomation();
});
