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
  let recoveryMode = false;
  let pendingConfirmationEmail = '';
  let resendCooldownTimer = null;
  let forgotCooldownTimer = null;

  function setAuthMode(mode) {
    authMode = mode;
    recoveryMode = false;
    const registering = mode === 'register';
    loginModeButton.setAttribute('aria-pressed', String(!registering));
    registerModeButton.setAttribute('aria-pressed', String(registering));
    submitButton.textContent = registering ? '创建账号' : '登录并同步';
    passwordLabel.textContent = '密码';
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    passwordInput.placeholder = registering ? '至少 8 位' : '请输入密码';
    passwordInput.readOnly = false;
    confirmPasswordField.hidden = true;
    confirmPasswordInput.required = false;
    confirmPasswordInput.value = '';
    forgotPasswordButton.hidden = registering;
    modeSwitch.hidden = false;
    setMessage('');
  }

  function setRecoveryMode() {
    authMode = 'recovery';
    recoveryMode = true;
    modeSwitch.hidden = true;
    passwordLabel.textContent = '新密码';
    passwordInput.autocomplete = 'new-password';
    passwordInput.placeholder = '至少 8 位';
    passwordInput.readOnly = false;
    confirmPasswordField.hidden = false;
    confirmPasswordInput.required = true;
    confirmPasswordInput.value = '';
    forgotPasswordButton.hidden = true;
    resendButton.hidden = true;
    submitButton.textContent = '保存新密码';
  }

  accountOpenButton.addEventListener('click', () => accountDialog.showModal());
  closeButton.addEventListener('click', () => accountDialog.close());
  loginModeButton.addEventListener('click', () => setAuthMode('login'));
  registerModeButton.addEventListener('click', () => setAuthMode('register'));

  const config = window.CHECKIN_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) {
    statusElement.textContent = '云端服务暂不可用，仍可在此设备使用';
    statusElement.dataset.state = 'error';
    syncHintElement.textContent = '本机记录仍可使用 · 云端配置暂不可用';
    syncHintElement.dataset.state = 'error';
    form.hidden = true;
    modeSwitch.hidden = true;
    forgotPasswordButton.hidden = true;
    retryCloudButton.hidden = true;
    messageElement.textContent = 'Supabase 配置或连接不可用。';
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);
  let user = null;
  let readyForSync = false;
  let syncTimer = null;
  let refreshInFlight = false;
  let prepareInFlight = false;

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
      syncHintElement.textContent = `已同步到云端${lastSyncLabel ? ` · 最近同步 ${lastSyncLabel}` : ''}`;
    } else {
      syncHintElement.textContent = `${message}${user && lastSyncLabel ? ` · 最近同步 ${lastSyncLabel}` : ''}`;
    }
    syncHintElement.dataset.state = state;
  }

  function markCloudSynced(message) {
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    setStatus(message, 'success');
  }

  function setMessage(message, isError = false) {
    messageElement.textContent = message;
    messageElement.dataset.state = isError ? 'error' : '';
  }

  function startResendCooldown(seconds = 60) {
    window.clearInterval(resendCooldownTimer);
    const originalLabel = '重发邮箱确认邮件';
    let remaining = seconds;
    resendButton.disabled = true;
    resendButton.textContent = `稍后可重发（${remaining} 秒）`;
    resendCooldownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(resendCooldownTimer);
        resendButton.disabled = false;
        resendButton.textContent = originalLabel;
        return;
      }
      resendButton.textContent = `稍后可重发（${remaining} 秒）`;
    }, 1000);
  }

  function showSession(session) {
    const signedIn = Boolean(session?.user);
    form.hidden = signedIn && !recoveryMode;
    modeSwitch.hidden = signedIn || recoveryMode;
    signoutButton.hidden = !signedIn || recoveryMode;
    accountOpenButton.textContent = signedIn ? '账号' : '登录';
    resendButton.hidden = signedIn || recoveryMode || !pendingConfirmationEmail;
    if (signedIn && recoveryMode) {
      emailInput.value = session.user.email || emailInput.value;
      emailInput.readOnly = true;
    }
    if (signedIn) {
      emailInput.value = session.user.email || '';
      if (!recoveryMode) passwordInput.value = '';
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
      if (!target) {
        target = merged.tasks.find((task) => task.title === localTask.title
          && task.startTime === localTask.startTime && task.endTime === localTask.endTime);
      }
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
    if (!merged.tasks.some((task) => task.id === merged.activeId)) {
      merged.activeId = merged.tasks[0]?.id;
    }
    return merged;
  }

  function explainError(error) {
    const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    if (error?.code === '42P01' || text.includes(TABLE)) {
      return 'Supabase 数据表尚未创建。请先在 SQL Editor 执行项目里的 supabase/setup.sql。';
    }
    if (error?.code === 'email_not_confirmed' || text.includes('email not confirmed')) {
      pendingConfirmationEmail = emailInput.value.trim();
      resendButton.hidden = !pendingConfirmationEmail;
      return '邮箱尚未验证。请先点击确认邮件中的链接；如果没收到，可以重发确认邮件。';
    }
    if (error?.code === 'invalid_credentials' || text.includes('invalid login credentials')) {
      return '邮箱或密码不匹配。如果刚注册，请先完成邮箱验证；重复注册同一邮箱不会重置密码。';
    }
    if (error?.code === 'over_email_send_rate_limit' || text.includes('rate limit') || text.includes('too many requests')) {
      return 'Supabase 邮件发送过于频繁。请稍等一段时间，并检查收件箱和垃圾邮件。';
    }
    if (isNetworkError(error)) {
      return '当前网络无法连接 Supabase。打卡记录仍保存在本机；检查网络后请重试登录或同步。';
    }
    return error?.message || '云端操作失败，请检查网络和 Supabase 设置。';
  }

  function isNetworkError(error) {
    const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return ['failed to fetch', 'fetch failed', 'networkerror', 'network request failed', 'load failed', 'not fetch', 'err_connection', 'timed out', 'timeout'].some((phrase) => text.includes(phrase));
  }

  function showRequestError(error) {
    setMessage(explainError(error), true);
    if (isNetworkError(error)) {
      setStatus('云端暂不可达，记录仍保存在本机；网络恢复后请重试登录或同步', 'error');
    }
  }

  async function writeCloudSnapshot(snapshot) {
    if (!user || !readyForSync || !validSnapshot(snapshot)) return;
    if (!navigator.onLine) {
      setStatus('等待网络恢复后同步', 'error');
      return;
    }
    setStatus('正在同步到云端…');
    try {
      const { error } = await client.from(TABLE).upsert({
        user_id: user.id,
        state: snapshot,
      }, { onConflict: 'user_id' });
      if (error) {
        setStatus(explainError(error), 'error');
        return;
      }
    } catch (error) {
      setStatus(explainError(error), 'error');
      return;
    }
    markCloudSynced(`已同步到云端 · ${user.email || '已登录'}`);
  }

  async function prepareAccountSync(nextUser) {
    if (!nextUser) {
      user = null;
      readyForSync = false;
      showSession(null);
      setStatus(navigator.onLine ? '已退出登录，记录保留在此设备' : '离线状态，记录保留在此设备');
      return;
    }
    if (user?.id === nextUser.id && readyForSync) return;
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
    setStatus('正在读取云端记录…');
    setMessage('');

    let data;
    let error;
    try {
      ({ data, error } = await client.from(TABLE)
        .select('state')
        .eq('user_id', user.id)
        .maybeSingle());
    } catch (requestError) {
      error = requestError;
    }
    if (error) {
      setStatus(explainError(error), 'error');
      setMessage(isNetworkError(error)
        ? '账号已登录，但当前网络无法连接云端。本机记录仍在；网络恢复后点“立即重试同步”。'
        : '本机记录仍可使用；请检查 Supabase 数据表配置。', true);
      return;
    }

    const cloudRow = data;
    const local = window.getCheckinSnapshot?.();
    if (cloudRow && validSnapshot(cloudRow.state)) {
      const merged = mergeSnapshots(local || { tasks: [] }, cloudRow.state);
      const localJson = stableJson(local);
      const mergedJson = stableJson(merged);
      if (localJson !== mergedJson) {
        if (local) {
          const backupKey = `${BACKUP_PREFIX}${new Date().toISOString()}`;
          localStorage.setItem(backupKey, JSON.stringify(local));
        }
        if (!window.applyCheckinSnapshot?.(merged)) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        }
        if (mergedJson !== stableJson(cloudRow.state)) {
          let saveError;
          try {
            ({ error: saveError } = await client.from(TABLE).upsert({ user_id: user.id, state: merged }, { onConflict: 'user_id' }));
          } catch (requestError) {
            saveError = requestError;
          }
          if (saveError) {
            setStatus(explainError(saveError), 'error');
            return;
          }
        }
      }
      if (localJson === mergedJson) localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } else {
      const initialState = local || { tasks: [] };
      if (!validSnapshot(initialState)) {
        setStatus('找不到可同步的本机记录，请刷新页面后重试。', 'error');
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
      let saveError;
      try {
        ({ error: saveError } = await client.from(TABLE).upsert({ user_id: user.id, state: initialState }, { onConflict: 'user_id' }));
      } catch (requestError) {
        saveError = requestError;
      }
      if (saveError) {
        setStatus(explainError(saveError), 'error');
        return;
      }
      setMessage('已将此设备已有的任务、打卡和备注首次导入云端。');
    }

    readyForSync = true;
    showSession({ user });
    markCloudSynced(`已同步到云端 · ${user.email || '已登录'}`);
  }

  async function refreshCloudSnapshot() {
    if (!user || !readyForSync || !navigator.onLine || refreshInFlight) return;
    refreshInFlight = true;
    try {
      let data;
      let error;
      try {
        ({ data, error } = await client.from(TABLE)
          .select('state')
          .eq('user_id', user.id)
          .maybeSingle());
      } catch (requestError) {
        error = requestError;
      }
      if (error) {
        setStatus(explainError(error), 'error');
        return;
      }
      const cloudRow = data;
      if (!cloudRow || !validSnapshot(cloudRow.state)) {
        await writeCloudSnapshot(window.getCheckinSnapshot?.());
        return;
      }
      const local = window.getCheckinSnapshot?.();
      const merged = mergeSnapshots(local || { tasks: [] }, cloudRow.state);
      const mergedJson = stableJson(merged);
      if (mergedJson !== stableJson(local)) {
        if (local) localStorage.setItem(`${BACKUP_PREFIX}${new Date().toISOString()}`, JSON.stringify(local));
        if (!window.applyCheckinSnapshot?.(merged)) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        }
        if (mergedJson !== stableJson(cloudRow.state)) {
          let saveError;
          try {
            ({ error: saveError } = await client.from(TABLE).upsert({ user_id: user.id, state: merged }, { onConflict: 'user_id' }));
          } catch (requestError) {
            saveError = requestError;
          }
          if (saveError) {
            setStatus(explainError(saveError), 'error');
            return;
          }
        }
        markCloudSynced(`已同步到云端 · ${user.email || '已登录'}`);
        return;
      }
      if (mergedJson !== stableJson(cloudRow.state)) {
        await writeCloudSnapshot(merged);
      } else {
        markCloudSynced(`已同步到云端 · ${user.email || '已登录'}`);
      }
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      refreshInFlight = false;
    }
  }

  async function handleLogin() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setMessage('请输入邮箱和密码。', true);
      return;
    }
    setMessage('正在登录…');
    submitButton.disabled = true;
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        showRequestError(error);
        resendButton.hidden = !pendingConfirmationEmail;
      }
    } catch (error) {
      showRequestError(error);
    } finally {
      submitButton.disabled = false;
    }
  }

  async function handleRegister() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || password.length < 8) {
      setMessage('请输入邮箱，并设置至少 8 位密码。', true);
      return;
    }
    setMessage('正在创建账号…');
    submitButton.disabled = true;
    let data;
    let error;
    try {
      const redirectTo = `${location.origin}${location.pathname}`;
      ({ data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      }));
    } catch (requestError) {
      showRequestError(requestError);
      submitButton.disabled = false;
      return;
    }
    submitButton.disabled = false;
    if (error) {
      showRequestError(error);
      if (error.code === 'over_email_send_rate_limit') {
        pendingConfirmationEmail = email;
        resendButton.hidden = false;
        startResendCooldown();
      }
    } else if (!data.session) {
      pendingConfirmationEmail = email;
      resendButton.hidden = false;
      setAuthMode('login');
      passwordInput.value = '';
      startResendCooldown();
      if (data.user?.identities?.length === 0) {
        setMessage('这个邮箱可能已经注册。请切换到“登录”；如果邮箱还没验证，可重发确认邮件。');
      } else {
        setMessage('请检查邮箱和垃圾邮件中的确认链接。验证完成后再回来登录；若没收到，可重发确认邮件。');
      }
    } else {
      setMessage('账号创建成功，正在准备首次同步…');
    }
  }

  async function handlePasswordRecovery() {
    const password = passwordInput.value;
    const confirmation = confirmPasswordInput.value;
    if (password.length < 8) {
      setMessage('新密码至少需要 8 位。', true);
      return;
    }
    if (password !== confirmation) {
      setMessage('两次输入的新密码不一致。', true);
      return;
    }
    submitButton.disabled = true;
    setMessage('正在更新密码…');
    try {
      const { data, error } = await client.auth.updateUser({ password });
      if (error) {
        showRequestError(error);
        return;
      }
      recoveryMode = false;
      setAuthMode('login');
      passwordInput.value = '';
      confirmPasswordInput.value = '';
      accountDialog.close();
      showSession({ user: data.user });
      setMessage('密码已更新，正在同步账号记录…');
      await prepareAccountSync(data.user);
    } catch (error) {
      showRequestError(error);
    } finally {
      submitButton.disabled = false;
    }
  }

  async function requestPasswordRecovery() {
    const email = emailInput.value.trim();
    if (!email || !emailInput.checkValidity()) {
      setMessage('请先输入有效的邮箱地址。', true);
      emailInput.focus();
      return;
    }
    forgotPasswordButton.disabled = true;
    setMessage('正在发送密码恢复邮件…');
    try {
      const redirectTo = `${location.origin}${location.pathname}`;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        showRequestError(error);
      } else {
        setMessage('如果该邮箱可以恢复密码，Supabase 已尝试发送邮件。请检查收件箱和垃圾邮件。');
      }
    } catch (error) {
      showRequestError(error);
    } finally {
      let remaining = 60;
      forgotPasswordButton.textContent = `稍后可重试（${remaining} 秒）`;
      forgotCooldownTimer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          window.clearInterval(forgotCooldownTimer);
          forgotPasswordButton.disabled = false;
          forgotPasswordButton.textContent = '忘记密码？';
        } else {
          forgotPasswordButton.textContent = `稍后可重试（${remaining} 秒）`;
        }
      }, 1000);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (authMode === 'register') await handleRegister();
    else if (authMode === 'recovery') await handlePasswordRecovery();
    else await handleLogin();
  });
  forgotPasswordButton.addEventListener('click', requestPasswordRecovery);
  resendButton.addEventListener('click', async () => {
    const email = pendingConfirmationEmail || emailInput.value.trim();
    if (!email) {
      setMessage('请先输入注册时使用的邮箱。', true);
      return;
    }
    resendButton.disabled = true;
    setMessage('正在发送确认邮件…');
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo },
    });
    resendButton.disabled = false;
    if (error) {
      setMessage(explainError(error), true);
      if (error.code === 'over_email_send_rate_limit') startResendCooldown();
    } else {
      setMessage('如果此邮箱需要验证，Supabase 已尝试发送确认邮件。请检查收件箱和垃圾邮件。');
      startResendCooldown();
    }
  });
  signoutButton.addEventListener('click', async () => {
    setMessage('正在退出登录…');
    const { error } = await client.auth.signOut();
    if (error) setMessage(explainError(error), true);
    else setMessage('已退出登录，本机记录仍保留。');
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
  window.addEventListener('offline', () => {
    setStatus(user
      ? '等待网络恢复后同步'
      : '登录和云同步需要网络；本机记录仍可使用', 'error');
  });
  window.addEventListener('focus', resumeCloudSync);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resumeCloudSync();
  });

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      setRecoveryMode();
      showSession(session);
      if (!accountDialog.open) accountDialog.showModal();
      setMessage('请输入并确认新密码。');
      return;
    }
    showSession(session);
    window.setTimeout(() => prepareAccountSync(session?.user || null), 0);
  });
})();
