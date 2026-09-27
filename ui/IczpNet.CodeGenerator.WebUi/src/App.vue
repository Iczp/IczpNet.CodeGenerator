<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

type Entity = { name: string; fullName: string; namespace: string; fingerprint: string };
type SourceProperty = { name: string; typeName: string; isNullable: boolean; isSystemManaged: boolean; documentation?: string | null; hasPublicSetter?: boolean; isCollection?: boolean };
type PropertyDescriptor = { displayName?: string; description?: string; required?: boolean; maxLength?: number; defaultValue?: string; dto?: boolean; create?: boolean; update?: boolean; filter?: string; sortable?: boolean };
type Descriptor = { entity: string; profile: string; crud: { get: boolean; getList: boolean; create: boolean; update: boolean; delete: boolean }; permissions: { enabled: boolean }; defaultSorting: string; properties: Record<string, PropertyDescriptor> };
type PlannedFile = { path: string; action: string; content: string; currentContent?: string | null; diff?: string | null };
type Plan = { files: PlannedFile[]; hasConflicts: boolean };
type Execution = { succeeded: boolean; logs: string[]; plan: Plan };
type DescriptorResponse = { descriptor: Descriptor; format: 'yaml' | 'json'; sourceProperties: SourceProperty[]; raw: string };

const entities = ref<Entity[]>([]);
const project = ref('');
const selectedEntity = ref<string>();
const sourceProperties = ref<SourceProperty[]>([]);
const descriptor = ref<Descriptor>();
const format = ref<'yaml' | 'json'>('yaml');
const raw = ref('');
const plan = ref<Plan>();
const selectedPath = ref<string>();
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const logs = ref<string[]>([]);
const ignoredPaths = ref<string[]>([]);
const overwritePaths = ref<string[]>([]);
const filterText = ref('');
const activeTab = ref('properties');
const outputTab = ref('preview');
const bottomVisible = ref(true);
let hydrating = false;
let saveTimer: number | undefined;
let skipNextDescriptorWatch = false;

const editableProperties = computed(() => sourceProperties.value.filter(property => !property.isSystemManaged));
const filteredEntities = computed(() => {
  const filter = filterText.value.trim().toLowerCase();
  return filter ? entities.value.filter(entity => entity.fullName.toLowerCase().includes(filter)) : entities.value;
});
const selectedFile = computed(() => plan.value?.files.find(file => file.path === selectedPath.value));
const planFiles = computed(() => plan.value?.files ?? []);
const generatedCount = computed(() => planFiles.value.filter(file => file.action !== 'Skip').length);
const statusColor = computed(() => plan.value?.hasConflicts ? 'error' : plan.value ? 'success' : 'default');
const statusText = computed(() => plan.value?.hasConflicts ? '需要处理冲突' : plan.value ? `${generatedCount.value} 个待应用变更` : '等待生成计划');

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

function normalize(value: Descriptor, properties: SourceProperty[]) {
  value.properties ??= {};
  for (const property of properties.filter(item => !item.isSystemManaged)) value.properties[property.name] ??= {};
  return value;
}

async function loadEntities() {
  loading.value = true;
  try {
    project.value = (await api<{ project: string }>('/api/project')).project;
    entities.value = await api<Entity[]>('/api/entities');
    selectedEntity.value ??= entities.value[0]?.name;
  } catch (reason) {
    error.value = String(reason);
  } finally {
    loading.value = false;
  }
}

async function loadDescriptor() {
  if (!selectedEntity.value) return;
  loading.value = true;
  error.value = '';
  try {
    const response = await api<DescriptorResponse>(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor`);
    hydrating = true;
    skipNextDescriptorWatch = true;
    sourceProperties.value = response.sourceProperties;
    descriptor.value = normalize(response.descriptor, response.sourceProperties);
    format.value = response.format;
    raw.value = response.raw;
    plan.value = undefined;
    selectedPath.value = undefined;
  } catch (reason) {
    error.value = String(reason);
  } finally {
    hydrating = false;
    loading.value = false;
  }
}

async function createPlan() {
  if (!selectedEntity.value) return;
  loading.value = true;
  try {
    plan.value = await api<Plan>('/api/generation/plan', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entity: selectedEntity.value })
    });
    selectedPath.value = plan.value.files[0]?.path;
    outputTab.value = 'preview';
  } catch (reason) {
    error.value = String(reason);
  } finally {
    loading.value = false;
  }
}

async function execute(action: 'generate' | 'validate' | 'format') {
  if (!selectedEntity.value) return;
  loading.value = true;
  error.value = '';
  try {
    const response = await api<Execution>(`/api/generation/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity: selectedEntity.value, ignoredPaths: ignoredPaths.value, overwritePaths: overwritePaths.value })
    });
    logs.value = response.logs ?? [`${action} completed.`];
    plan.value = response.plan;
    selectedPath.value = plan.value?.files[0]?.path;
    bottomVisible.value = true;
    if (!response.succeeded) error.value = `${action} failed.`;
  } catch (reason) {
    error.value = String(reason);
  } finally {
    loading.value = false;
  }
}

async function saveDescriptor() {
  if (!selectedEntity.value || !descriptor.value || hydrating) return;
  saving.value = true;
  error.value = '';
  try {
    const response = await api<DescriptorResponse>(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descriptor: descriptor.value, format: format.value })
    });
    hydrating = true;
    skipNextDescriptorWatch = true;
    descriptor.value = normalize(response.descriptor, sourceProperties.value);
    raw.value = response.raw;
    await createPlan();
  } catch (reason) {
    error.value = String(reason);
  } finally {
    hydrating = false;
    saving.value = false;
  }
}

async function saveRaw() {
  if (!selectedEntity.value) return;
  saving.value = true;
  error.value = '';
  try {
    const response = await api<DescriptorResponse>(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor/raw`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: raw.value, format: format.value })
    });
    hydrating = true;
    skipNextDescriptorWatch = true;
    descriptor.value = normalize(response.descriptor, sourceProperties.value);
    raw.value = response.raw;
    await createPlan();
  } catch (reason) {
    error.value = String(reason);
  } finally {
    hydrating = false;
    saving.value = false;
  }
}

function selectEntity({ key }: { key: string | number }) { selectedEntity.value = String(key); }
function typeHint(property: SourceProperty) {
  if (property.isCollection) return '集合';
  if (property.name.endsWith('Id')) return '引用候选';
  if (property.typeName.endsWith('Status') || property.typeName.endsWith('Type')) return '枚举候选';
  return '';
}
function actionColor(action: string) {
  return action === 'Conflict' ? 'red' : action === 'Update' ? 'orange' : action === 'Create' ? 'blue' : 'default';
}
function shortPath(path: string) { return path.split(/[\\/]/).slice(-2).join('/'); }
function keepCurrent(path: string) {
  if (!ignoredPaths.value.includes(path)) ignoredPaths.value.push(path);
  overwritePaths.value = overwritePaths.value.filter(item => item !== path);
}
function overwriteCurrent(path: string) {
  if (!overwritePaths.value.includes(path)) overwritePaths.value.push(path);
  ignoredPaths.value = ignoredPaths.value.filter(item => item !== path);
}

watch(selectedEntity, loadDescriptor);
watch(descriptor, () => {
  if (hydrating || !descriptor.value) return;
  if (skipNextDescriptorWatch) {
    skipNextDescriptorWatch = false;
    return;
  }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveDescriptor, 600);
}, { deep: true });
onMounted(loadEntities);
</script>

<template>
  <a-layout class="workbench">
    <a-layout-header class="titlebar">
      <div class="brand"><span class="brand-mark">◈</span><span>ABP Generator Studio</span><a-tag>ABP 10.6</a-tag></div>
      <div class="title-actions"><a-badge :status="statusColor" :text="statusText" /><a-button type="text" @click="loadEntities">刷新工作区</a-button></div>
    </a-layout-header>

    <a-layout class="shell">
      <a-layout-sider width="48" class="activitybar" theme="dark">
        <button class="activity active" title="资源管理器">▣</button>
        <button class="activity" title="生成计划" @click="createPlan">◫</button>
        <button class="activity" title="验证" @click="execute('validate')">✓</button>
        <button class="activity bottom" title="设置" @click="activeTab = 'advanced'">⚙</button>
      </a-layout-sider>

      <a-layout-sider width="288" class="explorer" theme="dark">
        <div class="panel-heading"><span>资源管理器</span><a-button type="text" size="small" @click="loadEntities">↻</a-button></div>
        <a-input v-model:value="filterText" class="entity-filter" placeholder="筛选实体" allow-clear />
        <div class="project-root"><span class="folder">⌄</span><span>{{ project.split(/[\\/]/).pop() || '项目' }}</span></div>
        <a-menu class="entity-menu" theme="dark" mode="inline" :selected-keys="selectedEntity ? [selectedEntity] : []" @click="selectEntity">
          <a-menu-item v-for="entity in filteredEntities" :key="entity.name">
            <span class="entity-icon">◇</span><span>{{ entity.name }}</span><small>{{ entity.namespace.split('.').pop() }}</small>
          </a-menu-item>
        </a-menu>
        <div class="explorer-footer"><span>{{ entities.length }} 个实体</span><span v-if="saving" class="saving">正在保存</span></div>
      </a-layout-sider>

      <a-layout class="main-area">
        <a-layout-content class="editor-area">
          <div v-if="error" class="error-banner"><span>!</span>{{ error }}<a-button type="link" size="small" @click="error = ''">关闭</a-button></div>
          <div class="breadcrumb"><span>工作区</span><span>/</span><span>{{ selectedEntity || '选择实体' }}</span><span v-if="descriptor">/</span><span v-if="descriptor">{{ descriptor.profile }}</span></div>
          <div class="editor-tabs"><button class="editor-tab active">{{ selectedEntity || '欢迎' }} <span>×</span></button></div>

          <div class="commandbar">
            <a-space :size="8"><a-button type="primary" :loading="loading || saving" @click="createPlan">生成计划</a-button><a-button :loading="loading" :disabled="!plan || plan.hasConflicts" @click="execute('generate')">应用生成</a-button><a-button :loading="loading" @click="execute('validate')">验证</a-button><a-button :loading="loading" @click="execute('format')">格式化预览</a-button></a-space>
            <a-tag v-if="saving" color="processing">保存配置中</a-tag>
          </div>

          <section v-if="descriptor" class="editor-surface">
            <a-tabs v-model:active-key="activeTab" class="workspace-tabs">
              <a-tab-pane key="properties" tab="实体属性">
                <div class="section-intro"><div><h2>{{ selectedEntity }}</h2><p>领域源代码只读；这里的选择会保存到 `.codegen`，并自动刷新生成计划。</p></div><a-tag>{{ editableProperties.length }} 个业务属性</a-tag></div>
                <a-table :data-source="editableProperties" :pagination="false" row-key="name" size="small" :scroll="{ x: 1420, y: 430 }" class="property-table">
                  <a-table-column title="属性" data-index="name" :width="146" fixed="left" />
                  <a-table-column title="类型" :width="150"><template #default="{ record }"><a-tag>{{ record.typeName }}</a-tag><a-tag v-if="record.isNullable">可空</a-tag><a-tag v-if="typeHint(record)" color="purple">{{ typeHint(record) }}</a-tag></template></a-table-column>
                  <a-table-column title="展示名" :width="138"><template #default="{ record }"><a-input v-model:value="descriptor.properties[record.name].displayName" /></template></a-table-column>
                  <a-table-column title="说明" :width="180"><template #default="{ record }"><a-input v-model:value="descriptor.properties[record.name].description" :placeholder="record.documentation || ''" /></template></a-table-column>
                  <a-table-column title="必填" :width="66"><template #default="{ record }"><a-switch v-model:checked="descriptor.properties[record.name].required" /></template></a-table-column>
                  <a-table-column title="长度" :width="88"><template #default="{ record }"><a-input-number v-model:value="descriptor.properties[record.name].maxLength" :min="1" /></template></a-table-column>
                  <a-table-column title="默认值" :width="118"><template #default="{ record }"><a-input v-model:value="descriptor.properties[record.name].defaultValue" /></template></a-table-column>
                  <a-table-column title="DTO" :width="62"><template #default="{ record }"><a-switch v-model:checked="descriptor.properties[record.name].dto" /></template></a-table-column>
                  <a-table-column title="创建" :width="62"><template #default="{ record }"><a-switch v-model:checked="descriptor.properties[record.name].create" /></template></a-table-column>
                  <a-table-column title="更新" :width="62"><template #default="{ record }"><a-switch v-model:checked="descriptor.properties[record.name].update" /></template></a-table-column>
                  <a-table-column title="筛选" :width="115"><template #default="{ record }"><a-select v-model:value="descriptor.properties[record.name].filter" allow-clear><a-select-option value="contains">包含</a-select-option><a-select-option value="equals">等于</a-select-option><a-select-option value="range">范围</a-select-option></a-select></template></a-table-column>
                  <a-table-column title="排序" :width="62"><template #default="{ record }"><a-switch v-model:checked="descriptor.properties[record.name].sortable" /></template></a-table-column>
                </a-table>
              </a-tab-pane>
              <a-tab-pane key="advanced" tab="配置原文">
                <div class="raw-toolbar"><a-radio-group v-model:value="format"><a-radio-button value="yaml">YAML</a-radio-button><a-radio-button value="json">JSON</a-radio-button></a-radio-group><a-button :loading="saving" @click="saveRaw">保存并刷新计划</a-button></div>
                <a-textarea v-model:value="raw" :auto-size="{ minRows: 22 }" class="raw-editor" />
              </a-tab-pane>
              <a-tab-pane key="output" tab="生成预览" @click="createPlan">
                <a-empty v-if="!plan" description="尚未创建生成计划"><a-button type="primary" @click="createPlan">创建计划</a-button></a-empty>
                <div v-else class="preview-layout">
                  <aside class="file-list"><div class="file-list-heading">输出文件 <span>{{ planFiles.length }}</span></div><button v-for="file in planFiles" :key="file.path" :class="['file-row', { selected: file.path === selectedPath }]" @click="selectedPath = file.path"><a-tag :color="actionColor(file.action)">{{ file.action }}</a-tag><span :title="file.path">{{ shortPath(file.path) }}</span></button></aside>
                  <div class="code-panel"><a-tabs v-model:active-key="outputTab"><a-tab-pane key="preview" tab="生成代码"><pre>{{ selectedFile?.content || '选择一个输出文件' }}</pre></a-tab-pane><a-tab-pane key="diff" tab="当前 / 生成"><div class="diff-columns"><div><h4>当前</h4><pre>{{ selectedFile?.currentContent ?? '新文件' }}</pre></div><div><h4>生成后</h4><pre>{{ selectedFile?.content }}</pre></div></div><p v-if="selectedFile?.diff" class="diff-summary">{{ selectedFile.diff }}</p></a-tab-pane></a-tabs></div>
                </div>
              </a-tab-pane>
            </a-tabs>
          </section>
          <a-empty v-else class="welcome" description="正在读取领域实体元数据" />
        </a-layout-content>

        <a-layout-sider width="312" class="inspector" theme="dark">
          <div class="panel-heading">检查器</div>
          <template v-if="descriptor">
            <div class="inspector-section"><label>实体</label><strong>{{ descriptor.entity }}</strong><label>Profile</label><a-tag color="blue">{{ descriptor.profile }}</a-tag><label>默认排序</label><a-input v-model:value="descriptor.defaultSorting" /></div>
            <div class="inspector-section"><label>生成操作</label><div class="switch-grid"><span>查询单项 <a-switch v-model:checked="descriptor.crud.get" size="small" /></span><span>查询列表 <a-switch v-model:checked="descriptor.crud.getList" size="small" /></span><span>创建 <a-switch v-model:checked="descriptor.crud.create" size="small" /></span><span>更新 <a-switch v-model:checked="descriptor.crud.update" size="small" /></span><span>删除 <a-switch v-model:checked="descriptor.crud.delete" size="small" /></span><span>权限 <a-switch v-model:checked="descriptor.permissions.enabled" size="small" /></span></div></div>
            <div class="inspector-section plan-summary"><label>生成计划</label><a-badge :status="statusColor" :text="statusText" /><div class="count-grid"><span>创建 <b>{{ planFiles.filter(file => file.action === 'Create').length }}</b></span><span>更新 <b>{{ planFiles.filter(file => file.action === 'Update').length }}</b></span><span>冲突 <b class="danger">{{ planFiles.filter(file => file.action === 'Conflict').length }}</b></span></div></div>
            <div v-if="selectedFile?.action === 'Conflict'" class="inspector-section conflict"><label>冲突处理</label><p>{{ selectedFile.diff }}</p><a-button block @click="keepCurrent(selectedFile.path)">保留当前文件</a-button><a-button block danger @click="overwriteCurrent(selectedFile.path)">允许覆盖</a-button></div>
          </template>
        </a-layout-sider>
      </a-layout>
    </a-layout>

    <div class="bottom-panel" :class="{ collapsed: !bottomVisible }">
      <div class="bottom-tabs"><span>▤ 输出</span><span>✓ 验证</span><span>⌁ 日志</span><button @click="bottomVisible = !bottomVisible">{{ bottomVisible ? '⌄' : '⌃' }}</button></div>
      <pre v-if="bottomVisible" class="log">{{ logs.length ? logs.join('\n') : '准备就绪。创建生成计划后，可在这里查看验证与写入日志。' }}</pre>
    </div>
    <div class="statusbar"><span>{{ selectedEntity ? `实体：${selectedEntity}` : '未选择实体' }}</span><span>{{ project }}</span></div>
  </a-layout>
</template>

<style scoped>
:global(body) { margin: 0; overflow: hidden; background: #151922; color: #d7dce5; }
:global(#app) { height: 100vh; }
.workbench { height: 100vh; min-width: 1060px; background: #1b202a; color: #d7dce5; }
.titlebar { height: 42px; line-height: 42px; padding: 0 14px; background: #151820; border-bottom: 1px solid #303642; display: flex; justify-content: space-between; color: #e8ebf1; }
.brand, .title-actions, .commandbar, .section-intro, .raw-toolbar, .bottom-tabs, .statusbar { display: flex; align-items: center; }
.brand { gap: 10px; font-weight: 600; }.brand-mark { color: #5f9dff; font-size: 20px; }.brand :deep(.ant-tag) { margin: 0; border: 0; background: #4a328b; color: #eee7ff; }
.title-actions { gap: 16px; font-size: 12px; }.title-actions :deep(.ant-btn) { color: #bdc7d9; }
.shell { min-height: 0; flex: 1; }.activitybar { background: #151820 !important; border-right: 1px solid #303642; display: flex; flex-direction: column; align-items: center; }.activity { width: 48px; height: 48px; border: 0; border-left: 2px solid transparent; color: #95a0b4; font-size: 20px; background: transparent; cursor: pointer; }.activity:hover,.activity.active { color: #fff; background: #202631; border-left-color: #5f9dff; }.activity.bottom { margin-top: auto; }
.explorer, .inspector { background: #1b202a !important; border-right: 1px solid #303642; }.inspector { border-right: 0; border-left: 1px solid #303642; }.panel-heading { height: 42px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between; color: #c9d1df; font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }.panel-heading :deep(.ant-btn) { color: #aeb9ca; }
.entity-filter { margin: 0 10px 10px; width: calc(100% - 20px); }.entity-filter :deep(input) { background: #121720; border-color: #3a4250; color: #dfe5f0; }.project-root { padding: 8px 14px; color: #e4e9f2; font-size: 13px; font-weight: 600; }.folder { margin-right: 8px; color: #91a5c6; }.entity-menu { background: transparent !important; border: 0 !important; }.entity-menu :deep(.ant-menu-item) { margin: 1px 0; width: 100%; color: #b9c3d4; }.entity-menu :deep(.ant-menu-item-selected) { background: #2b405d !important; color: #fff; }.entity-menu small { float: right; margin-top: 2px; color: #778398; }.entity-icon { color: #71a8ff; margin-right: 8px; }.explorer-footer { position: absolute; bottom: 0; width: 100%; padding: 10px 14px; display: flex; justify-content: space-between; color: #768297; font-size: 12px; background: #181d26; border-top: 1px solid #303642; }.saving { color: #75adff; }
.main-area { min-width: 0; }.editor-area { overflow: auto; background: #202631; }.breadcrumb { height: 30px; padding: 0 18px; gap: 7px; display: flex; align-items: center; color: #8592a8; font-size: 12px; background: #1d222c; }.editor-tabs { height: 38px; padding-left: 8px; background: #191e27; border-bottom: 1px solid #303642; }.editor-tab { height: 38px; padding: 0 15px; border: 0; border-top: 1px solid #5f9dff; color: #e9edf5; background: #202631; }.editor-tab span { margin-left: 24px; color: #8390a4; }.commandbar { justify-content: space-between; padding: 14px 18px; background: #202631; border-bottom: 1px solid #303642; }.editor-surface { padding: 0 18px 20px; }.workspace-tabs :deep(.ant-tabs-nav) { margin: 0; }.workspace-tabs :deep(.ant-tabs-tab) { color: #9da9bc; }.workspace-tabs :deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #70a8ff; }.workspace-tabs :deep(.ant-tabs-ink-bar) { background: #70a8ff; }.section-intro { justify-content: space-between; padding: 18px 0 14px; }.section-intro h2 { margin: 0 0 4px; font-size: 20px; color: #f1f4f8; }.section-intro p { margin: 0; color: #9aa6b8; font-size: 13px; }.property-table :deep(.ant-table) { background: #1b202a; color: #d6dce7; }.property-table :deep(.ant-table-thead > tr > th) { background: #262d3a; color: #b9c4d6; border-color: #343d4c; }.property-table :deep(.ant-table-tbody > tr > td) { border-color: #303846; }.property-table :deep(.ant-table-tbody > tr:hover > td) { background: #242b37 !important; }.property-table :deep(.ant-input),.property-table :deep(.ant-input-number),.property-table :deep(.ant-select-selector),.inspector :deep(.ant-input) { background: #151a22 !important; border-color: #3b4657 !important; color: #e5eaf2 !important; }.property-table :deep(.ant-input-number-input),.property-table :deep(.ant-select-selection-item),.inspector :deep(.ant-input) { color: #e5eaf2; }.raw-toolbar { justify-content: space-between; margin: 18px 0 10px; }.raw-editor :deep(textarea) { background: #161b23; color: #dce5f2; border-color: #394454; font-family: Consolas, monospace; line-height: 1.55; }.preview-layout { height: calc(100vh - 300px); min-height: 450px; display: grid; grid-template-columns: 270px minmax(0, 1fr); border: 1px solid #333d4c; }.file-list { overflow: auto; background: #191e27; border-right: 1px solid #333d4c; }.file-list-heading { padding: 11px 12px; color: #aeb9cb; font-size: 12px; text-transform: uppercase; }.file-list-heading span { float: right; }.file-row { width: 100%; padding: 8px 10px; display: flex; align-items: center; gap: 7px; border: 0; color: #bdc8d8; background: transparent; text-align: left; cursor: pointer; }.file-row:hover,.file-row.selected { background: #293a51; color: #fff; }.file-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.file-row :deep(.ant-tag) { min-width: 50px; margin: 0; text-align: center; }.code-panel { min-width: 0; padding: 0 12px; background: #171c24; }.code-panel :deep(.ant-tabs-tab) { color: #9ca9bd; }.code-panel :deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #70a8ff; }.code-panel pre { min-height: 360px; max-height: calc(100vh - 390px); overflow: auto; margin: 0; padding: 14px; color: #dce6f4; background: #141920; border: 1px solid #2d3745; font: 12px/1.55 Consolas, 'Courier New', monospace; white-space: pre; }.diff-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.diff-columns h4 { color: #aebad0; }.diff-summary { color: #d2a26d; font-size: 12px; }.welcome { margin-top: 20vh; }
.inspector-section { padding: 14px; border-bottom: 1px solid #303642; }.inspector-section label { display: block; margin: 0 0 7px; color: #8895a9; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }.inspector-section strong { display: block; margin-bottom: 15px; color: #e3e8f0; font-size: 12px; overflow-wrap: anywhere; }.inspector-section :deep(.ant-input) { margin-bottom: 4px; }.switch-grid { display: grid; gap: 10px; }.switch-grid span { display: flex; justify-content: space-between; color: #c3ccda; font-size: 13px; }.plan-summary :deep(.ant-badge-status-text) { color: #c3ccda; font-size: 12px; }.count-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 13px; }.count-grid span { padding: 8px 5px; color: #8896aa; text-align: center; font-size: 11px; background: #161b23; }.count-grid b { display: block; margin-top: 3px; color: #e4ebf5; font-size: 16px; }.count-grid .danger { color: #ff7f85; }.conflict p { color: #d8b177; font-size: 12px; }.conflict :deep(.ant-btn) { margin-top: 8px; }
.error-banner { margin: 12px 18px 0; padding: 9px 12px; display: flex; gap: 9px; align-items: center; color: #ffc3c5; background: #44272c; border: 1px solid #704149; }.error-banner span { font-weight: 700; }.error-banner :deep(.ant-btn) { margin-left: auto; color: #ffc3c5; }.bottom-panel { height: 190px; background: #191e27; border-top: 1px solid #303642; transition: height .16s ease; }.bottom-panel.collapsed { height: 30px; }.bottom-tabs { height: 30px; padding: 0 12px; gap: 18px; color: #aab6c7; font-size: 12px; }.bottom-tabs span:first-child { color: #fff; }.bottom-tabs button { margin-left: auto; border: 0; color: #aab6c7; background: transparent; cursor: pointer; }.log { height: 160px; overflow: auto; margin: 0; padding: 10px 14px; color: #c4d1e4; background: #151a22; font: 12px/1.55 Consolas, monospace; }.statusbar { height: 22px; padding: 0 12px; justify-content: space-between; color: #eaf1fb; font-size: 11px; background: #2d6fba; }
/* Ant Design renders nested scroll and fixed-column containers independently. */
.property-table :deep(.ant-table-container),.property-table :deep(.ant-table-content),.property-table :deep(.ant-table-body),.property-table :deep(table) { background: #1b202a; color: #d6dce7; }
.property-table :deep(.ant-table-tbody > tr > td),.property-table :deep(.ant-table-cell-fix-left),.property-table :deep(.ant-table-cell-fix-right) { color: #d6dce7; background: #1b202a; }
@media (max-width: 1280px) { .inspector { display: none; }.workbench { min-width: 840px; }.preview-layout { grid-template-columns: 220px minmax(0, 1fr); } }
</style>
