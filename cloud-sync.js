(() => {
  const STORAGE_KEY = 'evening-agreement-v4';
  const BACKUP_PREFIX = `${STORAGE_KEY}-before-cloud-`;
  const TABLE = 'user_checkin_data';
  const accountCard = document.querySelector('.account-card');
  const statusElement = document.querySelector('#cloud-status');
  const messageElement = document.querySelector('#cloud-message');
  const form = document.querySelector('#cloud-auth-form');
  const emailInput = document.querySelector('#cloud-email');
  const passwordInput = document.querySelector('#cloud-password');
  const loginButton = document.querySelector('#cloud-login');
  const registerButton = document.querySelector('#cloud-register');
  const signoutButton = document.querySelector('#cloud-signout');

  const config = window.CHECKIN_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) {
    statusElement.textContent = '云端服务暂不可用，仍可在此设备使用';
    statusElement.dataset.state = 'error';
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);
  let user = null;
  let readyForSync = false;
  let syncTimer = null;

  function setStatus(message, state = '') {
    statusElement.textContent = message;
    statusElement.dataset.state = state;
  }

  function setMessage(message, isError = false) {
    messageElement.textContent = message;
    messageElement.dataset.state = isError ? 'error' : '';
  }

  function showSession(session) {
    const signedIn = Boolean(session?.user);
    accountCard.dataset.authenticated = String(signedIn);
    signoutButton.hidden = !signedIn;
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
    for (const localTask of local.tasks || []) {
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
    if (text.includes('invalid login credentials')) return '邮箱或密码不正确。';
    if (text.includes('email not confirmed')) return '邮箱尚未验证，请先查看注册确认邮件。';
    if (text.includes('rate limit')) return '操作过于频繁，请稍等片刻再试。';
    return error?.message || '云端操作失败，请检查网络和 Supabase 设置。';
  }

  async function writeCloudSnapshot(snapshot) {
    if (!user || !readyForSync || !validSnapshot(snapshot)) return;
    setStatus('正在同步到云端…');
    const { error } = await client.from(TABLE).upsert({
      user_id: user.id,
      state: snapshot,
    }, { onConflict: 'user_id' });
    if (error) {
      setStatus(explainError(error), 'error');
      return;
    }
    setStatus(`已同步到云端 · ${user.email || '已登录'}`, 'success');
  }

  async function prepareAccountSync(nextUser) {
    if (!nextUser) {
      user = null;
      readyForSync = false;
      accountCard.dataset.authenticated = 'false';
      setStatus(navigator.onLine ? '已退出登录，记录保留在此设备' : '离线状态，记录保留在此设备');
      return;
    }
    if (user?.id === nextUser.id && readyForSync) return;
    user = nextUser;
    readyForSync = false;
    setStatus('正在读取云端记录…');
    setMessage('');

    const { data: cloudRow, error } = await client.from(TABLE)
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      setStatus(explainError(error), 'error');
      setMessage('本机记录仍可使用；完成 Supabase 数据表配置后即可同步。', true);
      return;
    }

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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        const { error: saveError } = await client.from(TABLE).upsert({ user_id: user.id, state: merged }, { onConflict: 'user_id' });
        if (saveError) {
          setStatus(explainError(saveError), 'error');
          return;
        }
        window.location.reload();
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } else {
      const initialState = local || { tasks: [] };
      if (!validSnapshot(initialState)) {
        setStatus('找不到可同步的本机记录，请刷新页面后重试。', 'error');
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
      const { error: saveError } = await client.from(TABLE).upsert({ user_id: user.id, state: initialState }, { onConflict: 'user_id' });
      if (saveError) {
        setStatus(explainError(saveError), 'error');
        return;
      }
      setMessage('已将此设备已有的任务、打卡和备注首次导入云端。');
    }

    readyForSync = true;
    showSession({ user });
    setStatus(`已同步到云端 · ${user.email || '已登录'}`, 'success');
  }

  async function refreshCloudSnapshot() {
    if (!user || !readyForSync || !navigator.onLine) return;
    const { data: cloudRow, error } = await client.from(TABLE)
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      setStatus(explainError(error), 'error');
      return;
    }
    if (!cloudRow || !validSnapshot(cloudRow.state)) {
      await writeCloudSnapshot(window.getCheckinSnapshot?.());
      return;
    }
    const local = window.getCheckinSnapshot?.();
    const merged = mergeSnapshots(local || { tasks: [] }, cloudRow.state);
    const mergedJson = stableJson(merged);
    if (mergedJson !== stableJson(local)) {
      if (local) localStorage.setItem(`${BACKUP_PREFIX}${new Date().toISOString()}`, JSON.stringify(local));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      if (mergedJson !== stableJson(cloudRow.state)) {
        const { error: saveError } = await client.from(TABLE).upsert({ user_id: user.id, state: merged }, { onConflict: 'user_id' });
        if (saveError) {
          setStatus(explainError(saveError), 'error');
          return;
        }
      }
      window.location.reload();
      return;
    }
    if (mergedJson !== stableJson(cloudRow.state)) {
      await writeCloudSnapshot(merged);
    } else {
      setStatus(`已同步到云端 · ${user.email || '已登录'}`, 'success');
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
    loginButton.disabled = true;
    registerButton.disabled = true;
    const { error } = await client.auth.signInWithPassword({ email, password });
    loginButton.disabled = false;
    registerButton.disabled = false;
    if (error) setMessage(explainError(error), true);
  }

  async function handleRegister() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || password.length < 8) {
      setMessage('请输入邮箱，并设置至少 8 位密码。', true);
      return;
    }
    setMessage('正在创建账号…');
    loginButton.disabled = true;
    registerButton.disabled = true;
    const redirectTo = `${location.origin}${location.pathname}`;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    });
    loginButton.disabled = false;
    registerButton.disabled = false;
    if (error) {
      setMessage(explainError(error), true);
    } else if (!data.session) {
      setMessage('账号已创建。请打开注册确认邮件，再回到此页面登录。');
    } else {
      setMessage('账号创建成功，正在准备首次同步…');
    }
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  loginButton.addEventListener('click', handleLogin);
  registerButton.addEventListener('click', handleRegister);
  signoutButton.addEventListener('click', async () => {
    setMessage('正在退出登录…');
    const { error } = await client.auth.signOut();
    if (error) setMessage(explainError(error), true);
    else setMessage('已退出登录，本机记录仍保留。');
  });

  window.addEventListener('checkin:state-changed', () => {
    if (!user || !readyForSync) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => writeCloudSnapshot(window.getCheckinSnapshot?.()), 500);
  });
  window.addEventListener('online', refreshCloudSnapshot);
  window.addEventListener('focus', refreshCloudSnapshot);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCloudSnapshot();
  });

  client.auth.onAuthStateChange((_event, session) => {
    showSession(session);
    window.setTimeout(() => prepareAccountSync(session?.user || null), 0);
  });
})();
