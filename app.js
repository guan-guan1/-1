const STORAGE_KEY = 'evening-agreement-v4';
const LEGACY_STORAGE_KEYS = ['evening-agreement-v3', 'evening-agreement-v2', 'evening-agreement-v1'];
const DEFAULT_PLAN = '晚上不点外卖';
const DEFAULT_START = '19:00';
const DEFAULT_END = '00:00';

const elements = {
  taskTabs: document.querySelector('#task-tabs'),
  addTask: document.querySelector('#add-task'),
  planTitle: document.querySelector('#plan-title'),
  planSchedule: document.querySelector('#plan-schedule'),
  todayStatus: document.querySelector('#today-status'),
  statusLabel: document.querySelector('#status-label'),
  statusValue: document.querySelector('#status-value'),
  selectedDayHint: document.querySelector('#selected-day-hint'),
  openNote: document.querySelector('#open-note'),
  dailyNote: document.querySelector('#daily-note'),
  dailyNoteTitle: document.querySelector('#daily-note-title'),
  dailyNoteText: document.querySelector('#daily-note-text'),
  grid: document.querySelector('#calendar-grid'),
  monthLabel: document.querySelector('#month-label'),
  successButton: document.querySelector('#success-button'),
  failButton: document.querySelector('#fail-button'),
  previousMonth: document.querySelector('#previous-month'),
  nextMonth: document.querySelector('#next-month'),
  confirmDialog: document.querySelector('#confirm-dialog'),
  confirmDetail: document.querySelector('#confirm-detail'),
  confirmEdit: document.querySelector('#confirm-edit'),
  cancelEdit: document.querySelector('#cancel-edit'),
  editDialog: document.querySelector('#edit-dialog'),
  editPlan: document.querySelector('#edit-plan'),
  planForm: document.querySelector('#plan-form'),
  planInput: document.querySelector('#plan-input'),
  planStartTime: document.querySelector('#plan-start-time'),
  planEndTime: document.querySelector('#plan-end-time'),
  deleteTask: document.querySelector('#delete-task'),
  deleteTaskNote: document.querySelector('#delete-task-note'),
  deleteTaskDialog: document.querySelector('#delete-task-dialog'),
  deleteTaskDetail: document.querySelector('#delete-task-detail'),
  cancelDeleteTask: document.querySelector('#cancel-delete-task'),
  confirmDeleteTask: document.querySelector('#confirm-delete-task'),
  noteDialog: document.querySelector('#note-dialog'),
  noteForm: document.querySelector('#note-form'),
  noteInput: document.querySelector('#note-input'),
  cancelNote: document.querySelector('#cancel-note'),
  newTaskDialog: document.querySelector('#new-task-dialog'),
  newTaskForm: document.querySelector('#new-task-form'),
  newTaskInput: document.querySelector('#new-task-input'),
  cancelNewTask: document.querySelector('#cancel-new-task'),
  newTaskStartTime: document.querySelector('#new-task-start-time'),
  newTaskEndTime: document.querySelector('#new-task-end-time'),
};

let today = localDateKey(new Date());
let state = readState();
let selectedDate = currentTaskDateKey(activeTask(), new Date());
let visibleMonth = monthDateFromKey(selectedDate);
let pendingSuccess = null;
let pendingDeleteId = null;

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthDateFromKey(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function createTask(title, startTime = DEFAULT_START, endTime = DEFAULT_END, days = {}, notes = {}) {
  return { id: makeId(), title, startTime, endTime, days, notes };
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeDeletedTaskIds(value) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && id))] : [];
}

function isValidTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object' || typeof task.title !== 'string') return null;
  const days = {};
  if (task.days && typeof task.days === 'object' && !Array.isArray(task.days)) {
    for (const [date, status] of Object.entries(task.days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && ['success', 'failure'].includes(status)) days[date] = status;
    }
  }
  const notes = {};
  if (task.notes && typeof task.notes === 'object' && !Array.isArray(task.notes)) {
    for (const [date, note] of Object.entries(task.notes)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof note === 'string' && note.trim()) {
        notes[date] = note.trim().slice(0, 1000);
      }
    }
  }
  let startTime = isValidTime(task.startTime) ? task.startTime : DEFAULT_START;
  let endTime = isValidTime(task.endTime) ? task.endTime : DEFAULT_END;
  if (startTime === endTime) {
    startTime = DEFAULT_START;
    endTime = DEFAULT_END;
  }
  return {
    id: typeof task.id === 'string' && task.id ? task.id : makeId(),
    title: task.title.trim().slice(0, 36) || DEFAULT_PLAN,
    startTime,
    endTime,
    days,
    notes,
  };
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.tasks)) {
      const deletedTaskIds = normalizeDeletedTaskIds(saved.deletedTaskIds);
      const deletedIds = new Set(deletedTaskIds);
      const tasks = saved.tasks.map(normalizeTask).filter((task) => task && !deletedIds.has(task.id));
      if (tasks.length) {
        return {
          tasks,
          activeId: tasks.some((task) => task.id === saved.activeId) ? saved.activeId : tasks[0].id,
          deletedTaskIds,
        };
      }
    }
  } catch {
    // Fall through to older state or a fresh default task.
  }

  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const legacy = JSON.parse(localStorage.getItem(key) || 'null');
      if (!legacy) continue;
      if (Array.isArray(legacy.tasks)) {
        const deletedTaskIds = normalizeDeletedTaskIds(legacy.deletedTaskIds);
        const deletedIds = new Set(deletedTaskIds);
        const tasks = legacy.tasks.map(normalizeTask).filter((task) => task && !deletedIds.has(task.id));
        if (tasks.length) {
          return {
            tasks,
            activeId: tasks.some((task) => task.id === legacy.activeId) ? legacy.activeId : tasks[0].id,
            deletedTaskIds,
          };
        }
      }
      const migrated = normalizeTask({
        id: 'legacy-default',
        title: typeof legacy.plan === 'string' && legacy.plan.trim() ? legacy.plan : DEFAULT_PLAN,
        startTime: DEFAULT_START,
        endTime: DEFAULT_END,
        days: legacy.days,
      });
      return { tasks: [migrated], activeId: migrated.id, deletedTaskIds: [] };
    } catch {
      // Try the next legacy storage key.
    }
  }

  const task = createTask(DEFAULT_PLAN);
  return { tasks: [task], activeId: task.id, deletedTaskIds: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  window.dispatchEvent(new CustomEvent('checkin:state-changed'));
}

window.getCheckinSnapshot = () => JSON.parse(JSON.stringify(state));

function activeTask() {
  return state.tasks.find((task) => task.id === state.activeId) || state.tasks[0];
}

function minutesForTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function activeCheckinDate(task, now) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = minutesForTime(task.startTime);
  const end = minutesForTime(task.endTime);

  if (start < end) {
    return currentMinutes >= start && currentMinutes < end ? localDateKey(now) : null;
  }
  if (currentMinutes >= start) return localDateKey(now);
  if (currentMinutes < end) {
    const previousDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return localDateKey(previousDate);
  }
  return null;
}

function currentTaskDateKey(task, now) {
  return activeCheckinDate(task, now) || localDateKey(now);
}

function isCrossMidnight(task) {
  return minutesForTime(task.endTime) < minutesForTime(task.startTime);
}

function scheduleLabel(task) {
  if (!isCrossMidnight(task)) return `${task.startTime}—${task.endTime}`;
  const end = task.endTime === '00:00' ? '24:00' : `次日 ${task.endTime}`;
  return `${task.startTime}—${end}`;
}

function dateLabel(key) {
  if (key === today) return '今天';
  const date = monthDateFromKey(key);
  const day = Number(key.slice(-2));
  return `${date.getMonth() + 1}月${day}日`;
}

function selectedStatus() {
  return activeTask().days[selectedDate] || 'pending';
}

function canRecordDate(task, date, now = new Date()) {
  const sessionDate = currentTaskDateKey(task, now);
  const status = task.days[date] || 'pending';
  if (status !== 'pending') return date === sessionDate && activeCheckinDate(task, now) === date;
  return date < sessionDate || (date === sessionDate && activeCheckinDate(task, now) === date);
}

function renderTasks() {
  elements.taskTabs.replaceChildren();
  state.tasks.forEach((task) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'task-tab';
    tab.id = `task-tab-${task.id}`;
    tab.setAttribute('aria-pressed', String(task.id === state.activeId));
    tab.textContent = task.title;
    tab.addEventListener('click', () => {
      state.activeId = task.id;
      selectedDate = currentTaskDateKey(task, new Date());
      visibleMonth = monthDateFromKey(selectedDate);
      saveState();
      render();
    });
    elements.taskTabs.append(tab);
  });
}

function renderStatus() {
  const task = activeTask();
  const now = new Date();
  const sessionDate = currentTaskDateKey(task, now);
  const currentWindowDate = activeCheckinDate(task, now);
  const status = selectedStatus();
  const canRecord = canRecordDate(task, selectedDate, now);
  const isFuture = selectedDate > localDateKey(now);
  const isPastLocked = status !== 'pending' && !canRecord;

  elements.statusLabel.textContent = selectedDate === localDateKey(now) ? '今天的记录' : `${dateLabel(selectedDate)}的记录`;
  elements.todayStatus.dataset.state = status;
  elements.statusValue.textContent = status === 'success'
    ? '今晚守住约定了'
    : status === 'failure'
      ? '今晚没忍住'
      : selectedDate === sessionDate ? '当前打卡日还没记录' : isFuture ? '还没到这一天' : '这天还没记录';

  let hint = `记录日期：${dateLabel(selectedDate)}`;
  if (currentWindowDate && currentWindowDate !== localDateKey(now) && selectedDate === currentWindowDate) {
    hint = `跨午夜打卡会记在前一天：${dateLabel(selectedDate)}`;
  } else if (canRecord && selectedDate < sessionDate) {
    hint = '这天没有记录，可以补录';
  } else if (isPastLocked && selectedDate === sessionDate) {
    hint = `当前不在可打卡时间内，已有记录暂不可修改`;
  } else if (isPastLocked) {
    hint = '这天已有记录，历史记录不能修改';
  } else if (!canRecord && isFuture) {
    hint = '未来日期暂不可打卡';
  } else if (currentWindowDate && selectedDate === localDateKey(now) && selectedDate !== currentWindowDate) {
    hint = `本次跨午夜打卡归到前一天：${dateLabel(currentWindowDate)}`;
  } else if (!canRecord && selectedDate === sessionDate) {
    hint = `仅可在每天 ${scheduleLabel(task)} 内打卡`;
  } else if (selectedDate !== sessionDate && !canRecord) {
    hint = '仅可补录没有记录的过去日期';
  }
  elements.selectedDayHint.textContent = hint;
  elements.successButton.innerHTML = status === 'success'
    ? '<span class="button-icon" aria-hidden="true">✓</span><span>已完成今晚打卡</span>'
    : '<span class="button-icon" aria-hidden="true">✓</span><span>今晚遵守了，完成打卡</span>';
  elements.failButton.innerHTML = status === 'failure'
    ? '<span class="button-icon" aria-hidden="true">↗</span><span>已记录：嘴馋了，没忍住</span>'
    : '<span class="button-icon" aria-hidden="true">↗</span><span>嘴馋了，没忍住</span>';
  elements.successButton.disabled = !canRecord;
  elements.failButton.disabled = !canRecord;
  renderDailyNote(task);
}

function renderDailyNote(task = activeTask()) {
  const note = task.notes[selectedDate] || '';
  elements.dailyNote.hidden = !note;
  elements.dailyNoteTitle.textContent = `${dateLabel(selectedDate)}的备注`;
  elements.dailyNoteText.textContent = note;
  elements.openNote.querySelector('span').textContent = note ? '编辑备注' : '添加备注';
}

function renderCalendar() {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const task = activeTask();
  const currentDate = currentTaskDateKey(task, new Date());
  elements.monthLabel.textContent = `${year}年${month + 1}月`;
  elements.grid.replaceChildren();

  const first = new Date(year, month, 1);
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;

  for (let index = 0; index < cellCount; index += 1) {
    const dayNumber = index - leading + 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day-cell';
    button.setAttribute('role', 'gridcell');

    if (dayNumber < 1 || dayNumber > daysInMonth) {
      button.disabled = true;
      button.tabIndex = -1;
      button.setAttribute('aria-hidden', 'true');
      elements.grid.append(button);
      continue;
    }

    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
    const status = task.days[key] || 'pending';
    const future = key > localDateKey(new Date());
    button.textContent = String(dayNumber);
    button.dataset.state = status;
    button.dataset.today = String(key === currentDate);
    button.dataset.selected = String(key === selectedDate);
    button.dataset.future = String(future);
    button.dataset.note = String(Boolean(task.notes[key]));
    button.disabled = future;
    button.setAttribute('aria-label', `${month + 1}月${dayNumber}日，${statusLabel(status)}${key === currentDate ? '，当前打卡日' : ''}${task.notes[key] ? '，有备注' : ''}`);
    if (future) button.tabIndex = -1;
    button.addEventListener('click', () => {
      selectedDate = key;
      render();
    });
    elements.grid.append(button);
  }
}

function statusLabel(status) {
  return status === 'success' ? '遵守约定' : status === 'failure' ? '没忍住' : '未记录';
}

function render() {
  renderTasks();
  const task = activeTask();
  elements.planTitle.textContent = task.title;
  elements.planSchedule.textContent = `每天 · ${scheduleLabel(task)}`;
  renderStatus();
  renderCalendar();
}

function record(status) {
  const task = activeTask();
  if (!canRecordDate(task, selectedDate)) return;
  task.days[selectedDate] = status;
  saveState();
  render();
}

elements.successButton.addEventListener('click', () => {
  if (!canRecordDate(activeTask(), selectedDate)) return;
  if (selectedStatus() === 'failure') {
    pendingSuccess = { taskId: state.activeId, date: selectedDate };
    elements.confirmDetail.textContent = `${dateLabel(selectedDate)}当前记录为“没忍住”。确认后会改为打卡成功。`;
    elements.confirmDialog.showModal();
    return;
  }
  record('success');
});

elements.failButton.addEventListener('click', () => record('failure'));
elements.confirmEdit.addEventListener('click', () => {
  const task = state.tasks.find((item) => item.id === pendingSuccess?.taskId);
  if (task && pendingSuccess && canRecordDate(task, pendingSuccess.date)) {
    task.days[pendingSuccess.date] = 'success';
    saveState();
  }
  pendingSuccess = null;
  elements.confirmDialog.close();
  render();
});
elements.cancelEdit.addEventListener('click', () => {
  pendingSuccess = null;
  elements.confirmDialog.close();
});

elements.previousMonth.addEventListener('click', () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});
elements.nextMonth.addEventListener('click', () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});

elements.openNote.addEventListener('click', () => {
  elements.noteInput.value = activeTask().notes[selectedDate] || '';
  elements.noteDialog.querySelector('#note-dialog-title').textContent = `${dateLabel(selectedDate)}的备注`;
  elements.noteDialog.showModal();
  elements.noteInput.focus();
});
elements.cancelNote.addEventListener('click', () => elements.noteDialog.close());
elements.noteForm.addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  const task = activeTask();
  const note = elements.noteInput.value.trim();
  if (note) task.notes[selectedDate] = note.slice(0, 1000);
  else delete task.notes[selectedDate];
  saveState();
  elements.noteDialog.close();
  render();
});

function setTimeRangeInputs(startInput, endInput, startTime, endTime) {
  startInput.value = startTime;
  endInput.value = endTime;
  startInput.setCustomValidity('');
  endInput.setCustomValidity('');
}

function validateTimeRange(startInput, endInput) {
  startInput.setCustomValidity('');
  endInput.setCustomValidity('');
  if (!startInput.value || !endInput.value) return false;
  if (startInput.value === endInput.value) {
    endInput.setCustomValidity('开始时间和结束时间不能相同，请选择一个有效时段。');
    endInput.reportValidity();
    return false;
  }
  return true;
}

elements.editPlan.addEventListener('click', () => {
  const task = activeTask();
  elements.planInput.value = task.title;
  setTimeRangeInputs(elements.planStartTime, elements.planEndTime, task.startTime, task.endTime);
  const cannotDeleteLastTask = state.tasks.length <= 1;
  elements.deleteTask.disabled = cannotDeleteLastTask;
  elements.deleteTaskNote.textContent = cannotDeleteLastTask ? '至少保留一项任务；请先新建其他任务再删除。' : '';
  elements.editDialog.showModal();
  elements.planInput.focus();
});
elements.planForm.addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  const nextPlan = elements.planInput.value.trim();
  if (!nextPlan) {
    elements.planInput.focus();
    return;
  }
  if (!validateTimeRange(elements.planStartTime, elements.planEndTime)) return;
  const task = activeTask();
  const previousSessionDate = currentTaskDateKey(task, new Date());
  task.title = nextPlan.slice(0, 36);
  task.startTime = elements.planStartTime.value;
  task.endTime = elements.planEndTime.value;
  if (selectedDate === previousSessionDate) {
    selectedDate = currentTaskDateKey(task, new Date());
    visibleMonth = monthDateFromKey(selectedDate);
  }
  saveState();
  elements.editDialog.close();
  render();
});

elements.deleteTask.addEventListener('click', () => {
  if (state.tasks.length <= 1) return;
  pendingDeleteId = state.activeId;
  const task = activeTask();
  elements.deleteTaskDetail.textContent = `“${task.title}”及其所有打卡记录会从本机删除；登录并同步后，也会从其他已同步设备移除。无法恢复。`;
  elements.editDialog.close();
  elements.deleteTaskDialog.showModal();
});

elements.cancelDeleteTask.addEventListener('click', () => {
  pendingDeleteId = null;
  elements.deleteTaskDialog.close();
  elements.editDialog.showModal();
});

elements.confirmDeleteTask.addEventListener('click', () => {
  const deletedIndex = state.tasks.findIndex((task) => task.id === pendingDeleteId);
  if (deletedIndex < 0 || state.tasks.length <= 1) {
    pendingDeleteId = null;
    elements.deleteTaskDialog.close();
    render();
    return;
  }

  state.deletedTaskIds = normalizeDeletedTaskIds(state.deletedTaskIds);
  if (!state.deletedTaskIds.includes(pendingDeleteId)) state.deletedTaskIds.push(pendingDeleteId);
  state.tasks.splice(deletedIndex, 1);
  if (state.activeId === pendingDeleteId) {
    const nextTask = state.tasks[Math.min(deletedIndex, state.tasks.length - 1)];
    state.activeId = nextTask.id;
    selectedDate = currentTaskDateKey(nextTask, new Date());
    visibleMonth = monthDateFromKey(selectedDate);
  }
  pendingDeleteId = null;
  saveState();
  elements.deleteTaskDialog.close();
  render();
});

elements.addTask.addEventListener('click', () => {
  elements.newTaskInput.value = '';
  setTimeRangeInputs(elements.newTaskStartTime, elements.newTaskEndTime, DEFAULT_START, DEFAULT_END);
  elements.newTaskDialog.showModal();
  elements.newTaskInput.focus();
});
elements.cancelNewTask.addEventListener('click', () => elements.newTaskDialog.close());
elements.newTaskForm.addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'create') return;
  event.preventDefault();
  const title = elements.newTaskInput.value.trim();
  if (!title) {
    elements.newTaskInput.focus();
    return;
  }
  if (!validateTimeRange(elements.newTaskStartTime, elements.newTaskEndTime)) return;
  const task = createTask(title.slice(0, 36), elements.newTaskStartTime.value, elements.newTaskEndTime.value);
  state.tasks.push(task);
  state.activeId = task.id;
  selectedDate = currentTaskDateKey(task, new Date());
  visibleMonth = monthDateFromKey(selectedDate);
  saveState();
  elements.newTaskDialog.close();
  render();
});

render();

window.setInterval(() => {
  const now = new Date();
  const nextToday = localDateKey(now);
  if (nextToday !== today) {
    const previousToday = today;
    today = nextToday;
    if (selectedDate === previousToday) {
      selectedDate = currentTaskDateKey(activeTask(), now);
      visibleMonth = monthDateFromKey(selectedDate);
    }
  }
  renderStatus();
  renderCalendar();
}, 30_000);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}
