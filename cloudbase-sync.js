import cloudbase from '@cloudbase/js-sdk/app';
import { registerAuth } from '@cloudbase/js-sdk/auth';
import { registerMySQL } from '@cloudbase/js-sdk/mysql';
import { createClient } from '@supabase/supabase-js';
import './app.js';
import './cloudbase-config.js';
import './supabase-config.js';

(() => {
  const STORAGE_KEY = 'evening-agreement-v4';
  const BACKUP_PREFIX = `${STORAGE_KEY}-before-cloud-`;
  const LAST_SYNC_KEY = `${STORAGE_KEY}-last-cloud-sync`;
  const TABLE = 'user_checkin_data';
  const accountDialog = document.querySelector('#account-dialog');
  const accountOpenButton = document.querySelector('#open-account');
  const statusElement = document.querySelector('#cloud-status');
  const syncHintElement = document.querySelector('#sync-hint');
  const retryCloudButton = document.querySelector('#retry-cloud');
  const messageElement = document.querySelector('#cloud-message');
  const form = document.querySelector('#cloud-auth-form');
  const emailInput = document.querySelector('#cloud-email');
  const passwordInput = document.querySelector('#cloud-password');
  const passwordLabel = document.querySelector('#cloud-password-label');
  const codeField = document.querySelector('#account-code-field');
  const codeInput = document.querySelector('#cloud-code');
  const confirmPasswordField = document.querySelector('#account-confirm-password');
  const confirmPasswordInput = document.querySelector('#cloud-password-confirm');
  const submitButton = document.querySelector('#cloud-submit');
  const loginModeButton = document.querySelector('#select-login');
  const registerModeButton = document.querySelector('#select-register');
  const modeSwitch = document.querySelector('.account-mode-switch');
  const resendButton = document.querySelector('#resend-confirmation');
  const forgotPasswordButton = document.querySelector('#forgot-password');
  const signoutButton = document.querySelector('#cloud-signout');
  const closeButton = document.querySelector('#close-account');
  let authMode = 'login';
  let pendingVerification = null;
  let pendingPasswordReset = null;
  let pendingEmail = '';
  let resendCooldownTimer = null;

  const config = window.CHECKIN_CLOUDBASE_CONFIG;
  if (!config?.env || !config?.publishableKey) {
    statusElement.textContent = 'CloudBase 配置暂不可用，仍可在此设备使用';
    statusElement.dataset.state = 'error';
    syncHintElement.textContent = '本机记录仍可使用 · CloudBase 配置暂不可用';
    syncHintElement.dataset.state = 'error';
    form.hidden = true;
    modeSwitch.hidden = true;
    forgotPasswordButton.hidden = true;
    retryCloudButton.hidden = true;
    messageElement.textContent = '请检查 CloudBase 环境 ID 和 Publishable Key 配置。';
    return;
  }

  registerAuth(cloudbase);
  registerMySQL(cloudbase);
  const app = cloudbase.init({ env: config.env, region: config.region || 'ap-shanghai', accessKey: config.publishableKey });
  const auth = app.auth;
  // CloudBase PostgreSQL（PG 模式）走 PostgREST：app.rdb() 提供 from/select/upsert 等语法。
  const rdb = typeof app.rdb === 'function' ? app.rdb() : null;
  if (!rdb) {
    statusElement.textContent = 'CloudBase 配置暂不可用，仍可在此设备使用';
    statusElement.dataset.state = 'error';
    syncHintElement.textContent = '本机记录仍可使用 · SDK 不支持 PostgreSQL 直连';
    syncHintElement.dataset.state = 'error';
    form.hidden = true;
    modeSwitch.hidden = true;
    forgotPasswordButton.hidden = true;
    retryCloudButton.hidden = true;
    messageElement.textContent = '当前 SDK 未提供 app.rdb()，请升级 @cloudbase/js-sdk 后再试。';
    return;
  }
  let user = null;
  let readyForSync = false;
  let syncTimer = null;
  let refreshInFlight = false;
  let prepareInFlight = false;
  let legacyReadAttempted = false;
  let legacySnapshot = null;
  const legacyConfig = window.CHECKIN_SUPABASE_CONFIG;
  const legacyClient = legacyConfig?.url && legacyConfig?.publishableKey
    ? createClient(legacyConfig.url, legacyConfig.publishableKey)
    : null;

  function setMessage(message, isError = false) {
    messageElement.textContent = message;
    messageElement.dataset.state = isError ? 'error' : '';
  }

  function setStatus(message, state = '') {
    statusElement.textContent = message;
    statusElement.dataset.state = state;
    retryCloudButton.hidden = !user;
    const lastSync = localStorage.getItem(LAST_SYNC_KEY);
    const lastSyncLabel = lastSync
      ? new Date(lastSync).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    if (state === 'error') {
      const savedLocally = navigator.onLine ? '本机已保存' : '离线 · 本机已保存';
      syncHintElement.textContent = `${savedLocally} · ${message}${lastSyncLabel ? ` · 最近同步 ${lastSyncLabel}` : ''}`;
    } else if (state === 'success') {
      syncHintElement.textContent = `已同步到 CloudBase${lastSyncLabel ? ` · 最近同步 ${lastSyncLabel}` : ''}`;
    } else {
      syncHintElement.textContent = `${message}${user && lastSyncLabel ? ` · 最近同步 ${lastSyncLabel}` : ''}`;
    }
    syncHintElement.dataset.state = state;
  }

  function markCloudSynced(message) {
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    setStatus(message, 'success');
  }

  function explainError(error) {
    const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    const code = String(error?.code || error?.errorCode || '').toLowerCase();
    if (code === 'resource_exhausted' || text.includes('rate limit') || text.includes('too many requests')) {
      return '验证码发送或登录请求过于频繁，请等待一段时间后再试。';
    }
    if (code === 'unimplemented' || code === 'login_type_disabled') {
      return 'CloudBase 邮箱登录或邮件代发尚未启用，请检查身份认证设置。';
    }
    if (code === 'failed_precondition') {
      return '无法完成此操作。若已有账号，请切换到登录；也可以检查邮箱地址后稍后再试。';
    }
    if (text.includes('invalid_credentials') || code === 'invalid_credentials') {
      return 'CloudBase 凭证无效：请核对 cloudbase-config.js 里的 Publishable Key 与控制台当前环境是否一致。';
    }
    if (text.includes('missing_credentials') || code === 'missing_credentials') {
      return 'CloudBase 请求缺少凭证：请确认 Publishable Key 已配置且没有过期。';
    }
    if (text.includes('42p01') || text.includes('does not exist')) {
      return 'CloudBase 数据库还没有 user_checkin_data 表：请先在 SQL 编辑器执行 cloudbase/user_checkin_data.sql。';
    }
    if (text.includes('row-level security') || text.includes('row level security') || text.includes('violates row-level')) {
      return 'CloudBase 行级权限（RLS）未通过：请确认 user_checkin_data 的 RLS 策略与 GRANT 已按 SQL 脚本建好。';
    }
    if (code === 'permission_denied' || text.includes('permission')) {
      return 'CloudBase 数据库权限未配置，请检查 user_checkin_data 表的 GRANT 与 RLS 策略。';
    }
    if (isNetworkError(error)) {
      return '当前网络暂时无法连接 CloudBase。打卡记录仍保存在本机；网络恢复后请重试。';
    }
    return error?.message || 'CloudBase 操作失败，请检查网络和控制台配置。';
  }

  function isNetworkError(error) {
    const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return ['failed to fetch', 'fetch failed', 'networkerror', 'network request failed', 'load failed', 'not fetch', 'err_connection', 'timed out', 'timeout'].some((phrase) => text.includes(phrase));
  }

  function showRequestError(error) {
    setMessage(explainError(error), true);
    if (isNetworkError(error)) setStatus('CloudBase 暂不可达，记录仍保存在本机；网络恢复后请重试', 'error');
  }

  function resetExtraFields() {
    codeField.hidden = true;
    codeInput.required = false;
    codeInput.value = '';
    confirmPasswordField.hidden = true;
    confirmPasswordInput.required = false;
    confirmPasswordInput.value = '';
    resendButton.hidden = true;
    pendingVerification = null;
    pendingPasswordReset = null;
  }

  function setAuthMode(mode) {
    authMode = mode;
    resetExtraFields();
    const registering = mode === 'register';
    loginModeButton.setAttribute('aria-pressed', String(!registering));
    registerModeButton.setAttribute('aria-pressed', String(registering));
    submitButton.textContent = registering ? '发送注册验证码' : '登录并同步';
    passwordLabel.textContent = '密码';
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    passwordInput.placeholder = registering ? '至少 8 位' : '请输入密码';
    passwordInput.readOnly = false;
    emailInput.readOnly = false;
    forgotPasswordButton.hidden = registering;
    forgotPasswordButton.disabled = false;
    forgotPasswordButton.textContent = '忘记密码？';
    modeSwitch.hidden = false;
    setMessage('');
  }

  function showVerificationStep(message, submitLabel = '验证并创建账号') {
    emailInput.readOnly = true;
    codeField.hidden = false;
    codeInput.required = true;
    resendButton.hidden = false;
    resendButton.dataset.mode = 'signup';
    resendButton.textContent = '重发邮箱验证码';
    submitButton.textContent = submitLabel;
    setMessage(message);
  }

  function showRecoveryStep(message = '输入邮件中的验证码，并设置新密码。') {
    authMode = 'recovery';
    emailInput.readOnly = true;
    modeSwitch.hidden = true;
    passwordLabel.textContent = '新密码';
    passwordInput.autocomplete = 'new-password';
    passwordInput.placeholder = '至少 8 位';
    passwordInput.readOnly = false;
    codeField.hidden = false;
    codeInput.required = true;
    confirmPasswordField.hidden = false;
    confirmPasswordInput.required = true;
    forgotPasswordButton.hidden = true;
    resendButton.hidden = false;
    resendButton.dataset.mode = 'recovery';
    resendButton.textContent = '重发恢复验证码';
    submitButton.textContent = '保存新密码';
    setMessage(message);
  }

  function showSession(session) {
    const signedIn = Boolean(session?.user);
    form.hidden = signedIn;
    modeSwitch.hidden = signedIn || authMode === 'recovery';
    signoutButton.hidden = !signedIn;
    resendButton.hidden = signedIn || (!pendingVerification && !pendingPasswordReset);
    accountOpenButton.textContent = signedIn ? '账号' : '登录';
    if (signedIn) {
      emailInput.value = session.user.email || '';
      passwordInput.value = '';
    }
  }

  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function validSnapshot(value) {
    return value && typeof value === 'object' && Array.isArray(value.tasks) && value.tasks.length > 0;
  }

  function mergeSnapshots(local, remote) {
    const merged = JSON.parse(JSON.stringify(remote));
    if (!Array.isArray(merged.tasks)) merged.tasks = [];
    const deletedTaskIds = [...new Set([
      ...(Array.isArray(remote.deletedTaskIds) ? remote.deletedTaskIds : []),
      ...(Array.isArray(local.deletedTaskIds) ? local.deletedTaskIds : []),
    ].filter((id) => typeof id === 'string' && id))];
    const deletedIds = new Set(deletedTaskIds);
    merged.deletedTaskIds = deletedTaskIds;
    merged.tasks = merged.tasks.filter((task) => !deletedIds.has(task.id));
    for (const localTask of local.tasks || []) {
      if (deletedIds.has(localTask.id)) continue;
      let target = merged.tasks.find((task) => task.id === localTask.id);
      if (!target) target = merged.tasks.find((task) => task.title === localTask.title && task.startTime === localTask.startTime && task.endTime === localTask.endTime);
      if (!target) {
        merged.tasks.push(JSON.parse(JSON.stringify(localTask)));
        continue;
      }
      target.days = { ...(localTask.days || {}), ...(target.days || {}) };
      target.notes = { ...(localTask.notes || {}), ...(target.notes || {}) };
    }
    if (!merged.tasks.length) {
      const fallback = [...(remote.tasks || []), ...(local.tasks || [])].find((task) => task && typeof task.id === 'string');
      if (fallback) {
        deletedIds.delete(fallback.id);
        merged.deletedTaskIds = [...deletedIds];
        merged.tasks = [JSON.parse(JSON.stringify(fallback))];
      }
    }
    if (!merged.tasks.some((task) => task.id === merged.activeId)) merged.activeId = merged.tasks[0]?.id;
    return merged;
  }

  function getUserId(account) {
    return account?.id || account?.uid || null;
  }

  async function getLegacySnapshot() {
    if (legacyReadAttempted) return legacySnapshot;
    legacyReadAttempted = true;
    if (!legacyClient || !navigator.onLine) return null;
    try {
      const { data: sessionData } = await legacyClient.auth.getSession();
      const oldUserId = sessionData?.session?.user?.id;
      if (!oldUserId) return null;
      const query = legacyClient.from(TABLE).select('state').eq('user_id', oldUserId).maybeSingle();
      const result = await Promise.race([
        query,
        new Promise((resolve) => window.setTimeout(() => resolve({ error: new Error('Legacy service timeout') }), 6000)),
      ]);
      if (!result?.error && validSnapshot(result?.data?.state)) legacySnapshot = result.data.state;
    } catch {
      // A failed legacy read must never prevent CloudBase login or overwrite local data.
    }
    return legacySnapshot;
  }

  async function cloudResult(promise) {
    const result = await promise;
    if (result?.error) throw result.error;
    if (result?.code && result.code !== 0) throw Object.assign(new Error(result.message || 'CloudBase request failed'), { code: result.code });
    return result;
  }

  function normalizeState(value) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  }

  async function readCloudSnapshot(account) {
    const userId = getUserId(account);
    if (!userId) return null;
    const result = await cloudResult(rdb.from(TABLE).select('state').eq('user_id', userId).maybeSingle());
    const row = result?.data;
    const state = row ? normalizeState(row.state) : null;
    return row && validSnapshot(state) ? { state, updatedAt: row.updated_at } : null;
  }

  async function persistSnapshot(userId, snapshot) {
    if (!userId) throw new Error('缺少用户标识，无法写入 CloudBase。');
    await cloudResult(rdb.from(TABLE).upsert({
      user_id: userId,
      state: snapshot,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }));
  }

  async function writeCloudSnapshot(snapshot) {
    if (!user || !readyForSync || !validSnapshot(snapshot)) return;
    if (!navigator.onLine) {
      setStatus('等待网络恢复后同步', 'error');
      return;
    }
    setStatus('正在同步到 CloudBase…');
    try {
      await persistSnapshot(getUserId(user), snapshot);
    } catch (error) {
      setStatus(explainError(error), 'error');
      return;
    }
    markCloudSynced(`已同步到 CloudBase · ${user.email || '已登录'}`);
  }

  async function prepareAccountSync(nextUser) {
    if (!nextUser) {
      user = null;
      readyForSync = false;
      showSession(null);
      setStatus(navigator.onLine ? '已退出登录，记录保留在此设备' : '离线状态，记录保留在此设备');
      return;
    }
    if (getUserId(user) === getUserId(nextUser) && readyForSync) return;
    if (prepareInFlight) return;
    prepareInFlight = true;
    retryCloudButton.disabled = true;
    try {
      await loadAccountSnapshot(nextUser);
    } catch (error) {
      setStatus(explainError(error), 'error');
      setMessage('同步请求未完成；本机记录仍保留，可以检查网络后重试。', true);
    } finally {
      prepareInFlight = false;
      retryCloudButton.disabled = false;
    }
  }

  async function loadAccountSnapshot(nextUser) {
    user = nextUser;
    readyForSync = false;
    setStatus('正在读取 CloudBase 记录…');
    setMessage('');
    const cloudDocument = await readCloudSnapshot(nextUser);
    const local = window.getCheckinSnapshot?.();
    const legacy = cloudDocument ? null : await getLegacySnapshot();
    let merged = cloudDocument?.state || local || legacy;
    if (!validSnapshot(merged)) {
      setStatus('找不到可同步的打卡记录，请刷新页面后重试。', 'error');
      return;
    }
    if (cloudDocument?.state) {
      if (validSnapshot(local)) merged = mergeSnapshots(local, merged);
      if (validSnapshot(legacy)) merged = mergeSnapshots(legacy, merged);
    } else {
      if (validSnapshot(legacy) && legacy !== merged) merged = mergeSnapshots(legacy, merged);
      if (validSnapshot(local) && local !== merged) merged = mergeSnapshots(local, merged);
    }

    const mergedJson = stableJson(merged);
    if (local && stableJson(local) !== mergedJson) {
      localStorage.setItem(`${BACKUP_PREFIX}${new Date().toISOString()}`, JSON.stringify(local));
      if (!window.applyCheckinSnapshot?.(merged)) localStorage.setItem(STORAGE_KEY, mergedJson);
    } else {
      localStorage.setItem(STORAGE_KEY, mergedJson);
    }

    if (!cloudDocument || stableJson(cloudDocument.state) !== mergedJson) {
      await persistSnapshot(getUserId(nextUser), merged);
      if (legacy && !cloudDocument) setMessage('已从本机记录及当前设备可访问的旧 Supabase 账号导入数据。');
      else if (!cloudDocument) setMessage('已将此设备已有的任务、打卡和备注首次导入 CloudBase。');
    }
    readyForSync = true;
    showSession({ user: nextUser });
    markCloudSynced(`已同步到 CloudBase · ${nextUser.email || '已登录'}`);
  }

  async function refreshCloudSnapshot() {
    if (!user || !readyForSync || !navigator.onLine || refreshInFlight) return;
    refreshInFlight = true;
    try {
      const cloudDocument = await readCloudSnapshot(user);
      if (!cloudDocument) {
        await writeCloudSnapshot(window.getCheckinSnapshot?.());
        return;
      }
      const local = window.getCheckinSnapshot?.();
      const merged = mergeSnapshots(local || { tasks: [] }, cloudDocument.state);
      const mergedJson = stableJson(merged);
      if (mergedJson !== stableJson(local)) {
        if (local) localStorage.setItem(`${BACKUP_PREFIX}${new Date().toISOString()}`, JSON.stringify(local));
        if (!window.applyCheckinSnapshot?.(merged)) localStorage.setItem(STORAGE_KEY, mergedJson);
      }
      if (mergedJson !== stableJson(cloudDocument.state)) await writeCloudSnapshot(merged);
      else markCloudSynced(`已同步到 CloudBase · ${user.email || '已登录'}`);
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      refreshInFlight = false;
    }
  }

  accountOpenButton.addEventListener('click', () => accountDialog.showModal());
  closeButton.addEventListener('click', () => accountDialog.close());
  loginModeButton.addEventListener('click', () => setAuthMode('login'));
  registerModeButton.addEventListener('click', () => setAuthMode('register'));

  async function handleLogin() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return setMessage('请输入邮箱和密码。', true);
    setMessage('正在登录…');
    const { data, error } = await auth.signInWithPassword({ email, password });
    if (error) return showRequestError(error);
    await prepareAccountSync(data.user);
  }

  async function handleRegister() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || password.length < 8) return setMessage('请输入邮箱，并设置至少 8 位密码。', true);
    if (!pendingVerification) {
      setMessage('正在发送注册验证码…');
      const { data, error } = await auth.signUp({ email, password });
      if (error) return showRequestError(error);
      pendingEmail = email;
      pendingVerification = data?.verifyOtp;
      if (typeof pendingVerification !== 'function') return setMessage('CloudBase 未返回验证码校验流程，请刷新后重试。', true);
      showVerificationStep('验证码已发送到邮箱，请输入邮件中的验证码。');
      startResendCooldown();
      return;
    }
    const token = codeInput.value.trim();
    if (!token) return setMessage('请输入邮箱验证码。', true);
    setMessage('正在验证邮箱…');
    const { data, error } = await pendingVerification({ token });
    if (error) return showRequestError(error);
    pendingVerification = null;
    setMessage('注册成功，正在准备首次同步…');
    await prepareAccountSync(data.user);
  }

  async function handlePasswordRecovery() {
    const password = passwordInput.value;
    const confirmation = confirmPasswordInput.value;
    const token = codeInput.value.trim();
    if (!pendingPasswordReset) return setMessage('请先请求密码恢复验证码。', true);
    if (!token) return setMessage('请输入邮箱验证码。', true);
    if (password.length < 8) return setMessage('新密码至少需要 8 位。', true);
    if (password !== confirmation) return setMessage('两次输入的新密码不一致。', true);
    setMessage('正在更新密码…');
    const { data, error } = await pendingPasswordReset({ nonce: token, password });
    if (error) return showRequestError(error);
    pendingPasswordReset = null;
    setAuthMode('login');
    passwordInput.value = '';
    confirmPasswordInput.value = '';
    accountDialog.close();
    await prepareAccountSync(data.user);
  }

  async function requestPasswordRecovery() {
    const email = emailInput.value.trim();
    if (!email || !emailInput.checkValidity()) {
      setMessage('请先输入有效的邮箱地址。', true);
      emailInput.focus();
      return;
    }
    forgotPasswordButton.disabled = true;
    setMessage('正在发送密码恢复验证码…');
    try {
      const { data, error } = await auth.resetPasswordForEmail(email);
      if (error) {
        showRequestError(error);
        forgotPasswordButton.disabled = false;
        return;
      }
      pendingEmail = email;
      pendingPasswordReset = data?.updateUser;
      if (typeof pendingPasswordReset !== 'function') {
        forgotPasswordButton.disabled = false;
        return setMessage('CloudBase 未返回密码恢复流程，请刷新后重试。', true);
      }
      passwordInput.value = '';
      showRecoveryStep('恢复验证码已发送到邮箱，请输入验证码并设置新密码。');
    } catch (error) {
      forgotPasswordButton.disabled = false;
      showRequestError(error);
    }
  }

  function startResendCooldown(seconds = 60) {
    window.clearInterval(resendCooldownTimer);
    let remaining = seconds;
    const resendLabel = resendButton.dataset.mode === 'recovery' ? '重发恢复验证码' : '重发邮箱验证码';
    resendButton.disabled = true;
    resendButton.textContent = `稍后可重发（${remaining} 秒）`;
    resendCooldownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(resendCooldownTimer);
        resendButton.disabled = false;
        resendButton.textContent = resendLabel;
        return;
      }
      resendButton.textContent = `稍后可重发（${remaining} 秒）`;
    }, 1000);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    try {
      if (authMode === 'register') await handleRegister();
      else if (authMode === 'recovery') await handlePasswordRecovery();
      else await handleLogin();
    } catch (error) {
      showRequestError(error);
    } finally {
      submitButton.disabled = false;
    }
  });

  forgotPasswordButton.addEventListener('click', requestPasswordRecovery);
  resendButton.addEventListener('click', async () => {
    const email = pendingEmail || emailInput.value.trim();
    if (!email) return setMessage('请先输入注册时使用的邮箱。', true);
    resendButton.disabled = true;
    setMessage('正在重发验证码…');
    if (authMode === 'recovery') {
      try {
        const { data, error } = await auth.resetPasswordForEmail(email);
        if (error) {
          setMessage(explainError(error), true);
          return;
        }
        pendingPasswordReset = data?.updateUser;
        setMessage('恢复验证码已重发，请检查邮箱和垃圾邮件。');
      } catch (error) {
        showRequestError(error);
      } finally {
        startResendCooldown();
      }
      return;
    }
    try {
      const { data, error } = await auth.resend({ email, type: 'signup' });
      if (error) {
        setMessage(explainError(error), true);
        return;
      }
      if (typeof pendingVerification === 'function') {
        const verify = pendingVerification;
        const messageId = data?.messageId;
        pendingVerification = ({ token }) => verify({ token, messageId });
      }
      setMessage('验证码已重发，请检查邮箱和垃圾邮件。');
    } catch (error) {
      showRequestError(error);
    } finally {
      startResendCooldown();
    }
  });

  signoutButton.addEventListener('click', async () => {
    setMessage('正在退出登录…');
    try {
      const { error } = await auth.signOut();
      if (error) setMessage(explainError(error), true);
      else setMessage('已退出登录，本机记录仍保留。');
    } catch (error) {
      showRequestError(error);
    }
  });

  retryCloudButton.addEventListener('click', async () => {
    if (!user) return;
    retryCloudButton.disabled = true;
    try {
      if (readyForSync) await refreshCloudSnapshot();
      else await prepareAccountSync(user);
    } finally {
      retryCloudButton.disabled = false;
    }
  });

  async function resumeCloudSync() {
    if (!user || !navigator.onLine) return;
    if (readyForSync) await refreshCloudSnapshot();
    else await prepareAccountSync(user);
  }

  window.addEventListener('checkin:state-changed', () => {
    if (!user || !readyForSync) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => writeCloudSnapshot(window.getCheckinSnapshot?.()), 500);
  });
  window.addEventListener('online', resumeCloudSync);
  window.addEventListener('offline', () => setStatus(user ? '等待网络恢复后同步' : '登录和云同步需要网络；本机记录仍可使用', 'error'));
  window.addEventListener('focus', resumeCloudSync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeCloudSync(); });

  auth.onAuthStateChange((event, session) => {
    showSession(session);
    window.setTimeout(() => prepareAccountSync(session?.user || null), 0);
  });

  auth.getSession().then(({ data, error }) => {
    if (error) setStatus(explainError(error), 'error');
    const session = data?.session;
    showSession(session);
    if (session?.user) prepareAccountSync(session.user);
  }).catch((error) => setStatus(explainError(error), 'error'));
})();
