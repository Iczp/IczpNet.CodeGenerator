import { computed, onMounted, ref, watch } from 'vue';
const entities = ref([]);
const project = ref('');
const selectedEntity = ref();
const sourceProperties = ref([]);
const descriptor = ref();
const format = ref('yaml');
const raw = ref('');
const plan = ref();
const selectedPath = ref();
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const logs = ref([]);
const ignoredPaths = ref([]);
const overwritePaths = ref([]);
const filterText = ref('');
const activeTab = ref('properties');
const outputTab = ref('preview');
const bottomVisible = ref(true);
let hydrating = false;
let saveTimer;
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
async function api(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(body.message ?? response.statusText);
    }
    return response.json();
}
function normalize(value, properties) {
    value.properties ??= {};
    for (const property of properties.filter(item => !item.isSystemManaged))
        value.properties[property.name] ??= {};
    return value;
}
async function loadEntities() {
    loading.value = true;
    try {
        project.value = (await api('/api/project')).project;
        entities.value = await api('/api/entities');
        selectedEntity.value ??= entities.value[0]?.name;
    }
    catch (reason) {
        error.value = String(reason);
    }
    finally {
        loading.value = false;
    }
}
async function loadDescriptor() {
    if (!selectedEntity.value)
        return;
    loading.value = true;
    error.value = '';
    try {
        const response = await api(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor`);
        hydrating = true;
        skipNextDescriptorWatch = true;
        sourceProperties.value = response.sourceProperties;
        descriptor.value = normalize(response.descriptor, response.sourceProperties);
        format.value = response.format;
        raw.value = response.raw;
        plan.value = undefined;
        selectedPath.value = undefined;
    }
    catch (reason) {
        error.value = String(reason);
    }
    finally {
        hydrating = false;
        loading.value = false;
    }
}
async function createPlan() {
    if (!selectedEntity.value)
        return;
    loading.value = true;
    try {
        plan.value = await api('/api/generation/plan', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entity: selectedEntity.value })
        });
        selectedPath.value = plan.value.files[0]?.path;
        outputTab.value = 'preview';
    }
    catch (reason) {
        error.value = String(reason);
    }
    finally {
        loading.value = false;
    }
}
async function execute(action) {
    if (!selectedEntity.value)
        return;
    loading.value = true;
    error.value = '';
    try {
        const response = await api(`/api/generation/${action}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entity: selectedEntity.value, ignoredPaths: ignoredPaths.value, overwritePaths: overwritePaths.value })
        });
        logs.value = response.logs ?? [`${action} completed.`];
        plan.value = response.plan;
        selectedPath.value = plan.value?.files[0]?.path;
        bottomVisible.value = true;
        if (!response.succeeded)
            error.value = `${action} failed.`;
    }
    catch (reason) {
        error.value = String(reason);
    }
    finally {
        loading.value = false;
    }
}
async function saveDescriptor() {
    if (!selectedEntity.value || !descriptor.value || hydrating)
        return;
    saving.value = true;
    error.value = '';
    try {
        const response = await api(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descriptor: descriptor.value, format: format.value })
        });
        hydrating = true;
        skipNextDescriptorWatch = true;
        descriptor.value = normalize(response.descriptor, sourceProperties.value);
        raw.value = response.raw;
        await createPlan();
    }
    catch (reason) {
        error.value = String(reason);
    }
    finally {
        hydrating = false;
        saving.value = false;
    }
}
async function saveRaw() {
    if (!selectedEntity.value)
        return;
    saving.value = true;
    error.value = '';
    try {
        const response = await api(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor/raw`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: raw.value, format: format.value })
        });
        hydrating = true;
        skipNextDescriptorWatch = true;
        descriptor.value = normalize(response.descriptor, sourceProperties.value);
        raw.value = response.raw;
        await createPlan();
    }
    catch (reason) {
        error.value = String(reason);
    }
    finally {
        hydrating = false;
        saving.value = false;
    }
}
function selectEntity({ key }) { selectedEntity.value = String(key); }
function typeHint(property) {
    if (property.isCollection)
        return '集合';
    if (property.name.endsWith('Id'))
        return '引用候选';
    if (property.typeName.endsWith('Status') || property.typeName.endsWith('Type'))
        return '枚举候选';
    return '';
}
function actionColor(action) {
    return action === 'Conflict' ? 'red' : action === 'Update' ? 'orange' : action === 'Create' ? 'blue' : 'default';
}
function shortPath(path) { return path.split(/[\\/]/).slice(-2).join('/'); }
function keepCurrent(path) {
    if (!ignoredPaths.value.includes(path))
        ignoredPaths.value.push(path);
    overwritePaths.value = overwritePaths.value.filter(item => item !== path);
}
function overwriteCurrent(path) {
    if (!overwritePaths.value.includes(path))
        overwritePaths.value.push(path);
    ignoredPaths.value = ignoredPaths.value.filter(item => item !== path);
}
watch(selectedEntity, loadDescriptor);
watch(descriptor, () => {
    if (hydrating || !descriptor.value)
        return;
    if (skipNextDescriptorWatch) {
        skipNextDescriptorWatch = false;
        return;
    }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDescriptor, 600);
}, { deep: true });
onMounted(loadEntities);
const __VLS_ctx = {
    ...{},
    ...{},
};
let ___VLS_components;
let ___VLS_directives;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
/** @type {__VLS_StyleScopedClasses['title-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['title-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['activity']} */ ;
/** @type {__VLS_StyleScopedClasses['activity']} */ ;
/** @type {__VLS_StyleScopedClasses['activity']} */ ;
/** @type {__VLS_StyleScopedClasses['inspector']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['entity-filter']} */ ;
/** @type {__VLS_StyleScopedClasses['entity-menu']} */ ;
/** @type {__VLS_StyleScopedClasses['entity-menu']} */ ;
/** @type {__VLS_StyleScopedClasses['entity-menu']} */ ;
/** @type {__VLS_StyleScopedClasses['editor-tab']} */ ;
/** @type {__VLS_StyleScopedClasses['commandbar']} */ ;
/** @type {__VLS_StyleScopedClasses['workspace-tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['workspace-tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['workspace-tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['section-intro']} */ ;
/** @type {__VLS_StyleScopedClasses['section-intro']} */ ;
/** @type {__VLS_StyleScopedClasses['section-intro']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-table-tbody']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['inspector']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-input']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['inspector']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-input']} */ ;
/** @type {__VLS_StyleScopedClasses['raw-toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['file-list-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['file-row']} */ ;
/** @type {__VLS_StyleScopedClasses['file-row']} */ ;
/** @type {__VLS_StyleScopedClasses['file-row']} */ ;
/** @type {__VLS_StyleScopedClasses['file-row']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['code-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-tabs-tab']} */ ;
/** @type {__VLS_StyleScopedClasses['code-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-tabs-tab-active']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-tabs-tab-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['code-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['diff-columns']} */ ;
/** @type {__VLS_StyleScopedClasses['inspector-section']} */ ;
/** @type {__VLS_StyleScopedClasses['inspector-section']} */ ;
/** @type {__VLS_StyleScopedClasses['inspector-section']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-input']} */ ;
/** @type {__VLS_StyleScopedClasses['switch-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['count-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['count-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['count-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['conflict']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['error-banner']} */ ;
/** @type {__VLS_StyleScopedClasses['error-banner']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['statusbar']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['ant-table-tbody']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['property-table']} */ ;
/** @type {__VLS_StyleScopedClasses['inspector']} */ ;
/** @type {__VLS_StyleScopedClasses['workbench']} */ ;
/** @type {__VLS_StyleScopedClasses['preview-layout']} */ ;
let __VLS_0;
/** @ts-ignore @type {typeof ___VLS_components.aLayout | typeof ___VLS_components.ALayout} */
aLayout;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ class: "workbench" },
}));
const __VLS_2 = __VLS_1({
    ...{ class: "workbench" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
var __VLS_5 = {};
/** @type {__VLS_StyleScopedClasses['workbench']} */ ;
const { default: __VLS_6 } = __VLS_3.slots;
let __VLS_7;
/** @ts-ignore @type {typeof ___VLS_components.aLayoutHeader | typeof ___VLS_components.ALayoutHeader} */
aLayoutHeader;
// @ts-ignore
const __VLS_8 = __VLS_asFunctionalComponent(__VLS_7, new __VLS_7({
    ...{ class: "titlebar" },
}));
const __VLS_9 = __VLS_8({
    ...{ class: "titlebar" },
}, ...__VLS_functionalComponentArgsRest(__VLS_8));
/** @type {__VLS_StyleScopedClasses['titlebar']} */ ;
const { default: __VLS_12 } = __VLS_10.slots;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "brand" },
});
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: "brand-mark" },
});
/** @type {__VLS_StyleScopedClasses['brand-mark']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
let __VLS_13;
/** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
aTag;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({}));
const __VLS_15 = __VLS_14({}, ...__VLS_functionalComponentArgsRest(__VLS_14));
const { default: __VLS_18 } = __VLS_16.slots;
var __VLS_16;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "title-actions" },
});
/** @type {__VLS_StyleScopedClasses['title-actions']} */ ;
let __VLS_19;
/** @ts-ignore @type {typeof ___VLS_components.aBadge | typeof ___VLS_components.ABadge} */
aBadge;
// @ts-ignore
const __VLS_20 = __VLS_asFunctionalComponent(__VLS_19, new __VLS_19({
    status: (__VLS_ctx.statusColor),
    text: (__VLS_ctx.statusText),
}));
const __VLS_21 = __VLS_20({
    status: (__VLS_ctx.statusColor),
    text: (__VLS_ctx.statusText),
}, ...__VLS_functionalComponentArgsRest(__VLS_20));
let __VLS_24;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
    ...{ 'onClick': {} },
    type: "text",
}));
const __VLS_26 = __VLS_25({
    ...{ 'onClick': {} },
    type: "text",
}, ...__VLS_functionalComponentArgsRest(__VLS_25));
let __VLS_29;
const __VLS_30 = ({ click: {} },
    { onClick: (__VLS_ctx.loadEntities) });
const { default: __VLS_31 } = __VLS_27.slots;
// @ts-ignore
[statusColor, statusText, loadEntities,];
var __VLS_27;
var __VLS_28;
// @ts-ignore
[];
var __VLS_10;
let __VLS_32;
/** @ts-ignore @type {typeof ___VLS_components.aLayout | typeof ___VLS_components.ALayout} */
aLayout;
// @ts-ignore
const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
    ...{ class: "shell" },
}));
const __VLS_34 = __VLS_33({
    ...{ class: "shell" },
}, ...__VLS_functionalComponentArgsRest(__VLS_33));
/** @type {__VLS_StyleScopedClasses['shell']} */ ;
const { default: __VLS_37 } = __VLS_35.slots;
let __VLS_38;
/** @ts-ignore @type {typeof ___VLS_components.aLayoutSider | typeof ___VLS_components.ALayoutSider} */
aLayoutSider;
// @ts-ignore
const __VLS_39 = __VLS_asFunctionalComponent(__VLS_38, new __VLS_38({
    width: "48",
    ...{ class: "activitybar" },
    theme: "dark",
}));
const __VLS_40 = __VLS_39({
    width: "48",
    ...{ class: "activitybar" },
    theme: "dark",
}, ...__VLS_functionalComponentArgsRest(__VLS_39));
/** @type {__VLS_StyleScopedClasses['activitybar']} */ ;
const { default: __VLS_43 } = __VLS_41.slots;
__VLS_asFunctionalElement(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ class: "activity active" },
    title: "资源管理器",
});
/** @type {__VLS_StyleScopedClasses['activity']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ onClick: (__VLS_ctx.createPlan) },
    ...{ class: "activity" },
    title: "生成计划",
});
/** @type {__VLS_StyleScopedClasses['activity']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.execute('validate');
            // @ts-ignore
            [createPlan, execute,];
        } },
    ...{ class: "activity" },
    title: "验证",
});
/** @type {__VLS_StyleScopedClasses['activity']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.activeTab = 'advanced';
            // @ts-ignore
            [activeTab,];
        } },
    ...{ class: "activity bottom" },
    title: "设置",
});
/** @type {__VLS_StyleScopedClasses['activity']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom']} */ ;
// @ts-ignore
[];
var __VLS_41;
let __VLS_44;
/** @ts-ignore @type {typeof ___VLS_components.aLayoutSider | typeof ___VLS_components.ALayoutSider} */
aLayoutSider;
// @ts-ignore
const __VLS_45 = __VLS_asFunctionalComponent(__VLS_44, new __VLS_44({
    width: "288",
    ...{ class: "explorer" },
    theme: "dark",
}));
const __VLS_46 = __VLS_45({
    width: "288",
    ...{ class: "explorer" },
    theme: "dark",
}, ...__VLS_functionalComponentArgsRest(__VLS_45));
/** @type {__VLS_StyleScopedClasses['explorer']} */ ;
const { default: __VLS_49 } = __VLS_47.slots;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "panel-heading" },
});
/** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
let __VLS_50;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_51 = __VLS_asFunctionalComponent(__VLS_50, new __VLS_50({
    ...{ 'onClick': {} },
    type: "text",
    size: "small",
}));
const __VLS_52 = __VLS_51({
    ...{ 'onClick': {} },
    type: "text",
    size: "small",
}, ...__VLS_functionalComponentArgsRest(__VLS_51));
let __VLS_55;
const __VLS_56 = ({ click: {} },
    { onClick: (__VLS_ctx.loadEntities) });
const { default: __VLS_57 } = __VLS_53.slots;
// @ts-ignore
[loadEntities,];
var __VLS_53;
var __VLS_54;
let __VLS_58;
/** @ts-ignore @type {typeof ___VLS_components.aInput | typeof ___VLS_components.AInput} */
aInput;
// @ts-ignore
const __VLS_59 = __VLS_asFunctionalComponent(__VLS_58, new __VLS_58({
    value: (__VLS_ctx.filterText),
    ...{ class: "entity-filter" },
    placeholder: "筛选实体",
    allowClear: true,
}));
const __VLS_60 = __VLS_59({
    value: (__VLS_ctx.filterText),
    ...{ class: "entity-filter" },
    placeholder: "筛选实体",
    allowClear: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_59));
/** @type {__VLS_StyleScopedClasses['entity-filter']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "project-root" },
});
/** @type {__VLS_StyleScopedClasses['project-root']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: "folder" },
});
/** @type {__VLS_StyleScopedClasses['folder']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
(__VLS_ctx.project.split(/[\\/]/).pop() || '项目');
let __VLS_63;
/** @ts-ignore @type {typeof ___VLS_components.aMenu | typeof ___VLS_components.AMenu} */
aMenu;
// @ts-ignore
const __VLS_64 = __VLS_asFunctionalComponent(__VLS_63, new __VLS_63({
    ...{ 'onClick': {} },
    ...{ class: "entity-menu" },
    theme: "dark",
    mode: "inline",
    selectedKeys: (__VLS_ctx.selectedEntity ? [__VLS_ctx.selectedEntity] : []),
}));
const __VLS_65 = __VLS_64({
    ...{ 'onClick': {} },
    ...{ class: "entity-menu" },
    theme: "dark",
    mode: "inline",
    selectedKeys: (__VLS_ctx.selectedEntity ? [__VLS_ctx.selectedEntity] : []),
}, ...__VLS_functionalComponentArgsRest(__VLS_64));
let __VLS_68;
const __VLS_69 = ({ click: {} },
    { onClick: (__VLS_ctx.selectEntity) });
/** @type {__VLS_StyleScopedClasses['entity-menu']} */ ;
const { default: __VLS_70 } = __VLS_66.slots;
for (const [entity] of __VLS_getVForSourceType((__VLS_ctx.filteredEntities))) {
    let __VLS_71;
    /** @ts-ignore @type {typeof ___VLS_components.aMenuItem | typeof ___VLS_components.AMenuItem} */
    aMenuItem;
    // @ts-ignore
    const __VLS_72 = __VLS_asFunctionalComponent(__VLS_71, new __VLS_71({
        key: (entity.name),
    }));
    const __VLS_73 = __VLS_72({
        key: (entity.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_72));
    const { default: __VLS_76 } = __VLS_74.slots;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "entity-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['entity-icon']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (entity.name);
    __VLS_asFunctionalElement(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (entity.namespace.split('.').pop());
    // @ts-ignore
    [filterText, project, selectedEntity, selectedEntity, selectEntity, filteredEntities,];
    var __VLS_74;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_66;
var __VLS_67;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "explorer-footer" },
});
/** @type {__VLS_StyleScopedClasses['explorer-footer']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
(__VLS_ctx.entities.length);
if (__VLS_ctx.saving) {
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "saving" },
    });
    /** @type {__VLS_StyleScopedClasses['saving']} */ ;
}
// @ts-ignore
[entities, saving,];
var __VLS_47;
let __VLS_77;
/** @ts-ignore @type {typeof ___VLS_components.aLayout | typeof ___VLS_components.ALayout} */
aLayout;
// @ts-ignore
const __VLS_78 = __VLS_asFunctionalComponent(__VLS_77, new __VLS_77({
    ...{ class: "main-area" },
}));
const __VLS_79 = __VLS_78({
    ...{ class: "main-area" },
}, ...__VLS_functionalComponentArgsRest(__VLS_78));
/** @type {__VLS_StyleScopedClasses['main-area']} */ ;
const { default: __VLS_82 } = __VLS_80.slots;
let __VLS_83;
/** @ts-ignore @type {typeof ___VLS_components.aLayoutContent | typeof ___VLS_components.ALayoutContent} */
aLayoutContent;
// @ts-ignore
const __VLS_84 = __VLS_asFunctionalComponent(__VLS_83, new __VLS_83({
    ...{ class: "editor-area" },
}));
const __VLS_85 = __VLS_84({
    ...{ class: "editor-area" },
}, ...__VLS_functionalComponentArgsRest(__VLS_84));
/** @type {__VLS_StyleScopedClasses['editor-area']} */ ;
const { default: __VLS_88 } = __VLS_86.slots;
if (__VLS_ctx.error) {
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "error-banner" },
    });
    /** @type {__VLS_StyleScopedClasses['error-banner']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.error);
    let __VLS_89;
    /** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
    aButton;
    // @ts-ignore
    const __VLS_90 = __VLS_asFunctionalComponent(__VLS_89, new __VLS_89({
        ...{ 'onClick': {} },
        type: "link",
        size: "small",
    }));
    const __VLS_91 = __VLS_90({
        ...{ 'onClick': {} },
        type: "link",
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_90));
    let __VLS_94;
    const __VLS_95 = ({ click: {} },
        { onClick: (...[$event]) => {
                if (!(__VLS_ctx.error))
                    return;
                __VLS_ctx.error = '';
                // @ts-ignore
                [error, error, error,];
            } });
    const { default: __VLS_96 } = __VLS_92.slots;
    // @ts-ignore
    [];
    var __VLS_92;
    var __VLS_93;
}
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "breadcrumb" },
});
/** @type {__VLS_StyleScopedClasses['breadcrumb']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
(__VLS_ctx.selectedEntity || '选择实体');
if (__VLS_ctx.descriptor) {
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
}
if (__VLS_ctx.descriptor) {
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.descriptor.profile);
}
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "editor-tabs" },
});
/** @type {__VLS_StyleScopedClasses['editor-tabs']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ class: "editor-tab active" },
});
/** @type {__VLS_StyleScopedClasses['editor-tab']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
(__VLS_ctx.selectedEntity || '欢迎');
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "commandbar" },
});
/** @type {__VLS_StyleScopedClasses['commandbar']} */ ;
let __VLS_97;
/** @ts-ignore @type {typeof ___VLS_components.aSpace | typeof ___VLS_components.ASpace} */
aSpace;
// @ts-ignore
const __VLS_98 = __VLS_asFunctionalComponent(__VLS_97, new __VLS_97({
    size: (8),
}));
const __VLS_99 = __VLS_98({
    size: (8),
}, ...__VLS_functionalComponentArgsRest(__VLS_98));
const { default: __VLS_102 } = __VLS_100.slots;
let __VLS_103;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_104 = __VLS_asFunctionalComponent(__VLS_103, new __VLS_103({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.loading || __VLS_ctx.saving),
}));
const __VLS_105 = __VLS_104({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.loading || __VLS_ctx.saving),
}, ...__VLS_functionalComponentArgsRest(__VLS_104));
let __VLS_108;
const __VLS_109 = ({ click: {} },
    { onClick: (__VLS_ctx.createPlan) });
const { default: __VLS_110 } = __VLS_106.slots;
// @ts-ignore
[createPlan, selectedEntity, selectedEntity, saving, descriptor, descriptor, descriptor, loading,];
var __VLS_106;
var __VLS_107;
let __VLS_111;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_112 = __VLS_asFunctionalComponent(__VLS_111, new __VLS_111({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
    disabled: (!__VLS_ctx.plan || __VLS_ctx.plan.hasConflicts),
}));
const __VLS_113 = __VLS_112({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
    disabled: (!__VLS_ctx.plan || __VLS_ctx.plan.hasConflicts),
}, ...__VLS_functionalComponentArgsRest(__VLS_112));
let __VLS_116;
const __VLS_117 = ({ click: {} },
    { onClick: (...[$event]) => {
            __VLS_ctx.execute('generate');
            // @ts-ignore
            [execute, loading, plan, plan,];
        } });
const { default: __VLS_118 } = __VLS_114.slots;
// @ts-ignore
[];
var __VLS_114;
var __VLS_115;
let __VLS_119;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_120 = __VLS_asFunctionalComponent(__VLS_119, new __VLS_119({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}));
const __VLS_121 = __VLS_120({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}, ...__VLS_functionalComponentArgsRest(__VLS_120));
let __VLS_124;
const __VLS_125 = ({ click: {} },
    { onClick: (...[$event]) => {
            __VLS_ctx.execute('validate');
            // @ts-ignore
            [execute, loading,];
        } });
const { default: __VLS_126 } = __VLS_122.slots;
// @ts-ignore
[];
var __VLS_122;
var __VLS_123;
let __VLS_127;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_128 = __VLS_asFunctionalComponent(__VLS_127, new __VLS_127({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}));
const __VLS_129 = __VLS_128({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}, ...__VLS_functionalComponentArgsRest(__VLS_128));
let __VLS_132;
const __VLS_133 = ({ click: {} },
    { onClick: (...[$event]) => {
            __VLS_ctx.execute('format');
            // @ts-ignore
            [execute, loading,];
        } });
const { default: __VLS_134 } = __VLS_130.slots;
// @ts-ignore
[];
var __VLS_130;
var __VLS_131;
// @ts-ignore
[];
var __VLS_100;
if (__VLS_ctx.saving) {
    let __VLS_135;
    /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
    aTag;
    // @ts-ignore
    const __VLS_136 = __VLS_asFunctionalComponent(__VLS_135, new __VLS_135({
        color: "processing",
    }));
    const __VLS_137 = __VLS_136({
        color: "processing",
    }, ...__VLS_functionalComponentArgsRest(__VLS_136));
    const { default: __VLS_140 } = __VLS_138.slots;
    // @ts-ignore
    [saving,];
    var __VLS_138;
}
if (__VLS_ctx.descriptor) {
    __VLS_asFunctionalElement(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "editor-surface" },
    });
    /** @type {__VLS_StyleScopedClasses['editor-surface']} */ ;
    let __VLS_141;
    /** @ts-ignore @type {typeof ___VLS_components.aTabs | typeof ___VLS_components.ATabs} */
    aTabs;
    // @ts-ignore
    const __VLS_142 = __VLS_asFunctionalComponent(__VLS_141, new __VLS_141({
        activeKey: (__VLS_ctx.activeTab),
        ...{ class: "workspace-tabs" },
    }));
    const __VLS_143 = __VLS_142({
        activeKey: (__VLS_ctx.activeTab),
        ...{ class: "workspace-tabs" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_142));
    /** @type {__VLS_StyleScopedClasses['workspace-tabs']} */ ;
    const { default: __VLS_146 } = __VLS_144.slots;
    let __VLS_147;
    /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
    aTabPane;
    // @ts-ignore
    const __VLS_148 = __VLS_asFunctionalComponent(__VLS_147, new __VLS_147({
        key: "properties",
        tab: "实体属性",
    }));
    const __VLS_149 = __VLS_148({
        key: "properties",
        tab: "实体属性",
    }, ...__VLS_functionalComponentArgsRest(__VLS_148));
    const { default: __VLS_152 } = __VLS_150.slots;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "section-intro" },
    });
    /** @type {__VLS_StyleScopedClasses['section-intro']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_ctx.selectedEntity);
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_153;
    /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
    aTag;
    // @ts-ignore
    const __VLS_154 = __VLS_asFunctionalComponent(__VLS_153, new __VLS_153({}));
    const __VLS_155 = __VLS_154({}, ...__VLS_functionalComponentArgsRest(__VLS_154));
    const { default: __VLS_158 } = __VLS_156.slots;
    (__VLS_ctx.editableProperties.length);
    // @ts-ignore
    [activeTab, selectedEntity, descriptor, editableProperties,];
    var __VLS_156;
    let __VLS_159;
    /** @ts-ignore @type {typeof ___VLS_components.aTable | typeof ___VLS_components.ATable} */
    aTable;
    // @ts-ignore
    const __VLS_160 = __VLS_asFunctionalComponent(__VLS_159, new __VLS_159({
        dataSource: (__VLS_ctx.editableProperties),
        pagination: (false),
        rowKey: "name",
        size: "small",
        scroll: ({ x: 1420, y: 430 }),
        ...{ class: "property-table" },
    }));
    const __VLS_161 = __VLS_160({
        dataSource: (__VLS_ctx.editableProperties),
        pagination: (false),
        rowKey: "name",
        size: "small",
        scroll: ({ x: 1420, y: 430 }),
        ...{ class: "property-table" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_160));
    /** @type {__VLS_StyleScopedClasses['property-table']} */ ;
    const { default: __VLS_164 } = __VLS_162.slots;
    let __VLS_165;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_166 = __VLS_asFunctionalComponent(__VLS_165, new __VLS_165({
        title: "属性",
        dataIndex: "name",
        width: (146),
        fixed: "left",
    }));
    const __VLS_167 = __VLS_166({
        title: "属性",
        dataIndex: "name",
        width: (146),
        fixed: "left",
    }, ...__VLS_functionalComponentArgsRest(__VLS_166));
    let __VLS_170;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_171 = __VLS_asFunctionalComponent(__VLS_170, new __VLS_170({
        title: "类型",
        width: (150),
    }));
    const __VLS_172 = __VLS_171({
        title: "类型",
        width: (150),
    }, ...__VLS_functionalComponentArgsRest(__VLS_171));
    const { default: __VLS_175 } = __VLS_173.slots;
    {
        const { default: __VLS_176 } = __VLS_173.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_176);
        let __VLS_177;
        /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
        aTag;
        // @ts-ignore
        const __VLS_178 = __VLS_asFunctionalComponent(__VLS_177, new __VLS_177({}));
        const __VLS_179 = __VLS_178({}, ...__VLS_functionalComponentArgsRest(__VLS_178));
        const { default: __VLS_182 } = __VLS_180.slots;
        (record.typeName);
        // @ts-ignore
        [editableProperties,];
        var __VLS_180;
        if (record.isNullable) {
            let __VLS_183;
            /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
            aTag;
            // @ts-ignore
            const __VLS_184 = __VLS_asFunctionalComponent(__VLS_183, new __VLS_183({}));
            const __VLS_185 = __VLS_184({}, ...__VLS_functionalComponentArgsRest(__VLS_184));
            const { default: __VLS_188 } = __VLS_186.slots;
            // @ts-ignore
            [];
            var __VLS_186;
        }
        if (__VLS_ctx.typeHint(record)) {
            let __VLS_189;
            /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
            aTag;
            // @ts-ignore
            const __VLS_190 = __VLS_asFunctionalComponent(__VLS_189, new __VLS_189({
                color: "purple",
            }));
            const __VLS_191 = __VLS_190({
                color: "purple",
            }, ...__VLS_functionalComponentArgsRest(__VLS_190));
            const { default: __VLS_194 } = __VLS_192.slots;
            (__VLS_ctx.typeHint(record));
            // @ts-ignore
            [typeHint, typeHint,];
            var __VLS_192;
        }
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_173;
    let __VLS_195;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_196 = __VLS_asFunctionalComponent(__VLS_195, new __VLS_195({
        title: "展示名",
        width: (138),
    }));
    const __VLS_197 = __VLS_196({
        title: "展示名",
        width: (138),
    }, ...__VLS_functionalComponentArgsRest(__VLS_196));
    const { default: __VLS_200 } = __VLS_198.slots;
    {
        const { default: __VLS_201 } = __VLS_198.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_201);
        let __VLS_202;
        /** @ts-ignore @type {typeof ___VLS_components.aInput | typeof ___VLS_components.AInput} */
        aInput;
        // @ts-ignore
        const __VLS_203 = __VLS_asFunctionalComponent(__VLS_202, new __VLS_202({
            value: (__VLS_ctx.descriptor.properties[record.name].displayName),
        }));
        const __VLS_204 = __VLS_203({
            value: (__VLS_ctx.descriptor.properties[record.name].displayName),
        }, ...__VLS_functionalComponentArgsRest(__VLS_203));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_198;
    let __VLS_207;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_208 = __VLS_asFunctionalComponent(__VLS_207, new __VLS_207({
        title: "说明",
        width: (180),
    }));
    const __VLS_209 = __VLS_208({
        title: "说明",
        width: (180),
    }, ...__VLS_functionalComponentArgsRest(__VLS_208));
    const { default: __VLS_212 } = __VLS_210.slots;
    {
        const { default: __VLS_213 } = __VLS_210.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_213);
        let __VLS_214;
        /** @ts-ignore @type {typeof ___VLS_components.aInput | typeof ___VLS_components.AInput} */
        aInput;
        // @ts-ignore
        const __VLS_215 = __VLS_asFunctionalComponent(__VLS_214, new __VLS_214({
            value: (__VLS_ctx.descriptor.properties[record.name].description),
            placeholder: (record.documentation || ''),
        }));
        const __VLS_216 = __VLS_215({
            value: (__VLS_ctx.descriptor.properties[record.name].description),
            placeholder: (record.documentation || ''),
        }, ...__VLS_functionalComponentArgsRest(__VLS_215));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_210;
    let __VLS_219;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_220 = __VLS_asFunctionalComponent(__VLS_219, new __VLS_219({
        title: "必填",
        width: (66),
    }));
    const __VLS_221 = __VLS_220({
        title: "必填",
        width: (66),
    }, ...__VLS_functionalComponentArgsRest(__VLS_220));
    const { default: __VLS_224 } = __VLS_222.slots;
    {
        const { default: __VLS_225 } = __VLS_222.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_225);
        let __VLS_226;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_227 = __VLS_asFunctionalComponent(__VLS_226, new __VLS_226({
            checked: (__VLS_ctx.descriptor.properties[record.name].required),
        }));
        const __VLS_228 = __VLS_227({
            checked: (__VLS_ctx.descriptor.properties[record.name].required),
        }, ...__VLS_functionalComponentArgsRest(__VLS_227));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_222;
    let __VLS_231;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_232 = __VLS_asFunctionalComponent(__VLS_231, new __VLS_231({
        title: "长度",
        width: (88),
    }));
    const __VLS_233 = __VLS_232({
        title: "长度",
        width: (88),
    }, ...__VLS_functionalComponentArgsRest(__VLS_232));
    const { default: __VLS_236 } = __VLS_234.slots;
    {
        const { default: __VLS_237 } = __VLS_234.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_237);
        let __VLS_238;
        /** @ts-ignore @type {typeof ___VLS_components.aInputNumber | typeof ___VLS_components.AInputNumber} */
        aInputNumber;
        // @ts-ignore
        const __VLS_239 = __VLS_asFunctionalComponent(__VLS_238, new __VLS_238({
            value: (__VLS_ctx.descriptor.properties[record.name].maxLength),
            min: (1),
        }));
        const __VLS_240 = __VLS_239({
            value: (__VLS_ctx.descriptor.properties[record.name].maxLength),
            min: (1),
        }, ...__VLS_functionalComponentArgsRest(__VLS_239));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_234;
    let __VLS_243;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_244 = __VLS_asFunctionalComponent(__VLS_243, new __VLS_243({
        title: "默认值",
        width: (118),
    }));
    const __VLS_245 = __VLS_244({
        title: "默认值",
        width: (118),
    }, ...__VLS_functionalComponentArgsRest(__VLS_244));
    const { default: __VLS_248 } = __VLS_246.slots;
    {
        const { default: __VLS_249 } = __VLS_246.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_249);
        let __VLS_250;
        /** @ts-ignore @type {typeof ___VLS_components.aInput | typeof ___VLS_components.AInput} */
        aInput;
        // @ts-ignore
        const __VLS_251 = __VLS_asFunctionalComponent(__VLS_250, new __VLS_250({
            value: (__VLS_ctx.descriptor.properties[record.name].defaultValue),
        }));
        const __VLS_252 = __VLS_251({
            value: (__VLS_ctx.descriptor.properties[record.name].defaultValue),
        }, ...__VLS_functionalComponentArgsRest(__VLS_251));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_246;
    let __VLS_255;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_256 = __VLS_asFunctionalComponent(__VLS_255, new __VLS_255({
        title: "DTO",
        width: (62),
    }));
    const __VLS_257 = __VLS_256({
        title: "DTO",
        width: (62),
    }, ...__VLS_functionalComponentArgsRest(__VLS_256));
    const { default: __VLS_260 } = __VLS_258.slots;
    {
        const { default: __VLS_261 } = __VLS_258.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_261);
        let __VLS_262;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_263 = __VLS_asFunctionalComponent(__VLS_262, new __VLS_262({
            checked: (__VLS_ctx.descriptor.properties[record.name].dto),
        }));
        const __VLS_264 = __VLS_263({
            checked: (__VLS_ctx.descriptor.properties[record.name].dto),
        }, ...__VLS_functionalComponentArgsRest(__VLS_263));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_258;
    let __VLS_267;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_268 = __VLS_asFunctionalComponent(__VLS_267, new __VLS_267({
        title: "创建",
        width: (62),
    }));
    const __VLS_269 = __VLS_268({
        title: "创建",
        width: (62),
    }, ...__VLS_functionalComponentArgsRest(__VLS_268));
    const { default: __VLS_272 } = __VLS_270.slots;
    {
        const { default: __VLS_273 } = __VLS_270.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_273);
        let __VLS_274;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_275 = __VLS_asFunctionalComponent(__VLS_274, new __VLS_274({
            checked: (__VLS_ctx.descriptor.properties[record.name].create),
        }));
        const __VLS_276 = __VLS_275({
            checked: (__VLS_ctx.descriptor.properties[record.name].create),
        }, ...__VLS_functionalComponentArgsRest(__VLS_275));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_270;
    let __VLS_279;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_280 = __VLS_asFunctionalComponent(__VLS_279, new __VLS_279({
        title: "更新",
        width: (62),
    }));
    const __VLS_281 = __VLS_280({
        title: "更新",
        width: (62),
    }, ...__VLS_functionalComponentArgsRest(__VLS_280));
    const { default: __VLS_284 } = __VLS_282.slots;
    {
        const { default: __VLS_285 } = __VLS_282.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_285);
        let __VLS_286;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_287 = __VLS_asFunctionalComponent(__VLS_286, new __VLS_286({
            checked: (__VLS_ctx.descriptor.properties[record.name].update),
        }));
        const __VLS_288 = __VLS_287({
            checked: (__VLS_ctx.descriptor.properties[record.name].update),
        }, ...__VLS_functionalComponentArgsRest(__VLS_287));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_282;
    let __VLS_291;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_292 = __VLS_asFunctionalComponent(__VLS_291, new __VLS_291({
        title: "筛选",
        width: (115),
    }));
    const __VLS_293 = __VLS_292({
        title: "筛选",
        width: (115),
    }, ...__VLS_functionalComponentArgsRest(__VLS_292));
    const { default: __VLS_296 } = __VLS_294.slots;
    {
        const { default: __VLS_297 } = __VLS_294.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_297);
        let __VLS_298;
        /** @ts-ignore @type {typeof ___VLS_components.aSelect | typeof ___VLS_components.ASelect} */
        aSelect;
        // @ts-ignore
        const __VLS_299 = __VLS_asFunctionalComponent(__VLS_298, new __VLS_298({
            value: (__VLS_ctx.descriptor.properties[record.name].filter),
            allowClear: true,
        }));
        const __VLS_300 = __VLS_299({
            value: (__VLS_ctx.descriptor.properties[record.name].filter),
            allowClear: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_299));
        const { default: __VLS_303 } = __VLS_301.slots;
        let __VLS_304;
        /** @ts-ignore @type {typeof ___VLS_components.aSelectOption | typeof ___VLS_components.ASelectOption} */
        aSelectOption;
        // @ts-ignore
        const __VLS_305 = __VLS_asFunctionalComponent(__VLS_304, new __VLS_304({
            value: "contains",
        }));
        const __VLS_306 = __VLS_305({
            value: "contains",
        }, ...__VLS_functionalComponentArgsRest(__VLS_305));
        const { default: __VLS_309 } = __VLS_307.slots;
        // @ts-ignore
        [descriptor,];
        var __VLS_307;
        let __VLS_310;
        /** @ts-ignore @type {typeof ___VLS_components.aSelectOption | typeof ___VLS_components.ASelectOption} */
        aSelectOption;
        // @ts-ignore
        const __VLS_311 = __VLS_asFunctionalComponent(__VLS_310, new __VLS_310({
            value: "equals",
        }));
        const __VLS_312 = __VLS_311({
            value: "equals",
        }, ...__VLS_functionalComponentArgsRest(__VLS_311));
        const { default: __VLS_315 } = __VLS_313.slots;
        // @ts-ignore
        [];
        var __VLS_313;
        let __VLS_316;
        /** @ts-ignore @type {typeof ___VLS_components.aSelectOption | typeof ___VLS_components.ASelectOption} */
        aSelectOption;
        // @ts-ignore
        const __VLS_317 = __VLS_asFunctionalComponent(__VLS_316, new __VLS_316({
            value: "range",
        }));
        const __VLS_318 = __VLS_317({
            value: "range",
        }, ...__VLS_functionalComponentArgsRest(__VLS_317));
        const { default: __VLS_321 } = __VLS_319.slots;
        // @ts-ignore
        [];
        var __VLS_319;
        // @ts-ignore
        [];
        var __VLS_301;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_294;
    let __VLS_322;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_323 = __VLS_asFunctionalComponent(__VLS_322, new __VLS_322({
        title: "排序",
        width: (62),
    }));
    const __VLS_324 = __VLS_323({
        title: "排序",
        width: (62),
    }, ...__VLS_functionalComponentArgsRest(__VLS_323));
    const { default: __VLS_327 } = __VLS_325.slots;
    {
        const { default: __VLS_328 } = __VLS_325.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_328);
        let __VLS_329;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_330 = __VLS_asFunctionalComponent(__VLS_329, new __VLS_329({
            checked: (__VLS_ctx.descriptor.properties[record.name].sortable),
        }));
        const __VLS_331 = __VLS_330({
            checked: (__VLS_ctx.descriptor.properties[record.name].sortable),
        }, ...__VLS_functionalComponentArgsRest(__VLS_330));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_325;
    // @ts-ignore
    [];
    var __VLS_162;
    // @ts-ignore
    [];
    var __VLS_150;
    let __VLS_334;
    /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
    aTabPane;
    // @ts-ignore
    const __VLS_335 = __VLS_asFunctionalComponent(__VLS_334, new __VLS_334({
        key: "advanced",
        tab: "配置原文",
    }));
    const __VLS_336 = __VLS_335({
        key: "advanced",
        tab: "配置原文",
    }, ...__VLS_functionalComponentArgsRest(__VLS_335));
    const { default: __VLS_339 } = __VLS_337.slots;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "raw-toolbar" },
    });
    /** @type {__VLS_StyleScopedClasses['raw-toolbar']} */ ;
    let __VLS_340;
    /** @ts-ignore @type {typeof ___VLS_components.aRadioGroup | typeof ___VLS_components.ARadioGroup} */
    aRadioGroup;
    // @ts-ignore
    const __VLS_341 = __VLS_asFunctionalComponent(__VLS_340, new __VLS_340({
        value: (__VLS_ctx.format),
    }));
    const __VLS_342 = __VLS_341({
        value: (__VLS_ctx.format),
    }, ...__VLS_functionalComponentArgsRest(__VLS_341));
    const { default: __VLS_345 } = __VLS_343.slots;
    let __VLS_346;
    /** @ts-ignore @type {typeof ___VLS_components.aRadioButton | typeof ___VLS_components.ARadioButton} */
    aRadioButton;
    // @ts-ignore
    const __VLS_347 = __VLS_asFunctionalComponent(__VLS_346, new __VLS_346({
        value: "yaml",
    }));
    const __VLS_348 = __VLS_347({
        value: "yaml",
    }, ...__VLS_functionalComponentArgsRest(__VLS_347));
    const { default: __VLS_351 } = __VLS_349.slots;
    // @ts-ignore
    [format,];
    var __VLS_349;
    let __VLS_352;
    /** @ts-ignore @type {typeof ___VLS_components.aRadioButton | typeof ___VLS_components.ARadioButton} */
    aRadioButton;
    // @ts-ignore
    const __VLS_353 = __VLS_asFunctionalComponent(__VLS_352, new __VLS_352({
        value: "json",
    }));
    const __VLS_354 = __VLS_353({
        value: "json",
    }, ...__VLS_functionalComponentArgsRest(__VLS_353));
    const { default: __VLS_357 } = __VLS_355.slots;
    // @ts-ignore
    [];
    var __VLS_355;
    // @ts-ignore
    [];
    var __VLS_343;
    let __VLS_358;
    /** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
    aButton;
    // @ts-ignore
    const __VLS_359 = __VLS_asFunctionalComponent(__VLS_358, new __VLS_358({
        ...{ 'onClick': {} },
        loading: (__VLS_ctx.saving),
    }));
    const __VLS_360 = __VLS_359({
        ...{ 'onClick': {} },
        loading: (__VLS_ctx.saving),
    }, ...__VLS_functionalComponentArgsRest(__VLS_359));
    let __VLS_363;
    const __VLS_364 = ({ click: {} },
        { onClick: (__VLS_ctx.saveRaw) });
    const { default: __VLS_365 } = __VLS_361.slots;
    // @ts-ignore
    [saving, saveRaw,];
    var __VLS_361;
    var __VLS_362;
    let __VLS_366;
    /** @ts-ignore @type {typeof ___VLS_components.aTextarea | typeof ___VLS_components.ATextarea} */
    aTextarea;
    // @ts-ignore
    const __VLS_367 = __VLS_asFunctionalComponent(__VLS_366, new __VLS_366({
        value: (__VLS_ctx.raw),
        autoSize: ({ minRows: 22 }),
        ...{ class: "raw-editor" },
    }));
    const __VLS_368 = __VLS_367({
        value: (__VLS_ctx.raw),
        autoSize: ({ minRows: 22 }),
        ...{ class: "raw-editor" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_367));
    /** @type {__VLS_StyleScopedClasses['raw-editor']} */ ;
    // @ts-ignore
    [raw,];
    var __VLS_337;
    let __VLS_371;
    /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
    aTabPane;
    // @ts-ignore
    const __VLS_372 = __VLS_asFunctionalComponent(__VLS_371, new __VLS_371({
        ...{ 'onClick': {} },
        key: "output",
        tab: "生成预览",
    }));
    const __VLS_373 = __VLS_372({
        ...{ 'onClick': {} },
        key: "output",
        tab: "生成预览",
    }, ...__VLS_functionalComponentArgsRest(__VLS_372));
    let __VLS_376;
    const __VLS_377 = ({ click: {} },
        { onClick: (__VLS_ctx.createPlan) });
    const { default: __VLS_378 } = __VLS_374.slots;
    if (!__VLS_ctx.plan) {
        let __VLS_379;
        /** @ts-ignore @type {typeof ___VLS_components.aEmpty | typeof ___VLS_components.AEmpty} */
        aEmpty;
        // @ts-ignore
        const __VLS_380 = __VLS_asFunctionalComponent(__VLS_379, new __VLS_379({
            description: "尚未创建生成计划",
        }));
        const __VLS_381 = __VLS_380({
            description: "尚未创建生成计划",
        }, ...__VLS_functionalComponentArgsRest(__VLS_380));
        const { default: __VLS_384 } = __VLS_382.slots;
        let __VLS_385;
        /** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
        aButton;
        // @ts-ignore
        const __VLS_386 = __VLS_asFunctionalComponent(__VLS_385, new __VLS_385({
            ...{ 'onClick': {} },
            type: "primary",
        }));
        const __VLS_387 = __VLS_386({
            ...{ 'onClick': {} },
            type: "primary",
        }, ...__VLS_functionalComponentArgsRest(__VLS_386));
        let __VLS_390;
        const __VLS_391 = ({ click: {} },
            { onClick: (__VLS_ctx.createPlan) });
        const { default: __VLS_392 } = __VLS_388.slots;
        // @ts-ignore
        [createPlan, createPlan, plan,];
        var __VLS_388;
        var __VLS_389;
        // @ts-ignore
        [];
        var __VLS_382;
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "preview-layout" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-layout']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
            ...{ class: "file-list" },
        });
        /** @type {__VLS_StyleScopedClasses['file-list']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "file-list-heading" },
        });
        /** @type {__VLS_StyleScopedClasses['file-list-heading']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (__VLS_ctx.planFiles.length);
        for (const [file] of __VLS_getVForSourceType((__VLS_ctx.planFiles))) {
            __VLS_asFunctionalElement(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.descriptor))
                            return;
                        if (!!(!__VLS_ctx.plan))
                            return;
                        __VLS_ctx.selectedPath = file.path;
                        // @ts-ignore
                        [planFiles, planFiles, selectedPath,];
                    } },
                key: (file.path),
                ...{ class: (['file-row', { selected: file.path === __VLS_ctx.selectedPath }]) },
            });
            /** @type {__VLS_StyleScopedClasses['selected']} */ ;
            /** @type {__VLS_StyleScopedClasses['file-row']} */ ;
            let __VLS_393;
            /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
            aTag;
            // @ts-ignore
            const __VLS_394 = __VLS_asFunctionalComponent(__VLS_393, new __VLS_393({
                color: (__VLS_ctx.actionColor(file.action)),
            }));
            const __VLS_395 = __VLS_394({
                color: (__VLS_ctx.actionColor(file.action)),
            }, ...__VLS_functionalComponentArgsRest(__VLS_394));
            const { default: __VLS_398 } = __VLS_396.slots;
            (file.action);
            // @ts-ignore
            [selectedPath, actionColor,];
            var __VLS_396;
            __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                title: (file.path),
            });
            (__VLS_ctx.shortPath(file.path));
            // @ts-ignore
            [shortPath,];
        }
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "code-panel" },
        });
        /** @type {__VLS_StyleScopedClasses['code-panel']} */ ;
        let __VLS_399;
        /** @ts-ignore @type {typeof ___VLS_components.aTabs | typeof ___VLS_components.ATabs} */
        aTabs;
        // @ts-ignore
        const __VLS_400 = __VLS_asFunctionalComponent(__VLS_399, new __VLS_399({
            activeKey: (__VLS_ctx.outputTab),
        }));
        const __VLS_401 = __VLS_400({
            activeKey: (__VLS_ctx.outputTab),
        }, ...__VLS_functionalComponentArgsRest(__VLS_400));
        const { default: __VLS_404 } = __VLS_402.slots;
        let __VLS_405;
        /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
        aTabPane;
        // @ts-ignore
        const __VLS_406 = __VLS_asFunctionalComponent(__VLS_405, new __VLS_405({
            key: "preview",
            tab: "生成代码",
        }));
        const __VLS_407 = __VLS_406({
            key: "preview",
            tab: "生成代码",
        }, ...__VLS_functionalComponentArgsRest(__VLS_406));
        const { default: __VLS_410 } = __VLS_408.slots;
        __VLS_asFunctionalElement(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({});
        (__VLS_ctx.selectedFile?.content || '选择一个输出文件');
        // @ts-ignore
        [outputTab, selectedFile,];
        var __VLS_408;
        let __VLS_411;
        /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
        aTabPane;
        // @ts-ignore
        const __VLS_412 = __VLS_asFunctionalComponent(__VLS_411, new __VLS_411({
            key: "diff",
            tab: "当前 / 生成",
        }));
        const __VLS_413 = __VLS_412({
            key: "diff",
            tab: "当前 / 生成",
        }, ...__VLS_functionalComponentArgsRest(__VLS_412));
        const { default: __VLS_416 } = __VLS_414.slots;
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "diff-columns" },
        });
        /** @type {__VLS_StyleScopedClasses['diff-columns']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
        __VLS_asFunctionalElement(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({});
        (__VLS_ctx.selectedFile?.currentContent ?? '新文件');
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
        __VLS_asFunctionalElement(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({});
        (__VLS_ctx.selectedFile?.content);
        if (__VLS_ctx.selectedFile?.diff) {
            __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "diff-summary" },
            });
            /** @type {__VLS_StyleScopedClasses['diff-summary']} */ ;
            (__VLS_ctx.selectedFile.diff);
        }
        // @ts-ignore
        [selectedFile, selectedFile, selectedFile, selectedFile,];
        var __VLS_414;
        // @ts-ignore
        [];
        var __VLS_402;
    }
    // @ts-ignore
    [];
    var __VLS_374;
    var __VLS_375;
    // @ts-ignore
    [];
    var __VLS_144;
}
else {
    let __VLS_417;
    /** @ts-ignore @type {typeof ___VLS_components.aEmpty | typeof ___VLS_components.AEmpty} */
    aEmpty;
    // @ts-ignore
    const __VLS_418 = __VLS_asFunctionalComponent(__VLS_417, new __VLS_417({
        ...{ class: "welcome" },
        description: "正在读取领域实体元数据",
    }));
    const __VLS_419 = __VLS_418({
        ...{ class: "welcome" },
        description: "正在读取领域实体元数据",
    }, ...__VLS_functionalComponentArgsRest(__VLS_418));
    /** @type {__VLS_StyleScopedClasses['welcome']} */ ;
}
// @ts-ignore
[];
var __VLS_86;
let __VLS_422;
/** @ts-ignore @type {typeof ___VLS_components.aLayoutSider | typeof ___VLS_components.ALayoutSider} */
aLayoutSider;
// @ts-ignore
const __VLS_423 = __VLS_asFunctionalComponent(__VLS_422, new __VLS_422({
    width: "312",
    ...{ class: "inspector" },
    theme: "dark",
}));
const __VLS_424 = __VLS_423({
    width: "312",
    ...{ class: "inspector" },
    theme: "dark",
}, ...__VLS_functionalComponentArgsRest(__VLS_423));
/** @type {__VLS_StyleScopedClasses['inspector']} */ ;
const { default: __VLS_427 } = __VLS_425.slots;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "panel-heading" },
});
/** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
if (__VLS_ctx.descriptor) {
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "inspector-section" },
    });
    /** @type {__VLS_StyleScopedClasses['inspector-section']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.descriptor.entity);
    __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    let __VLS_428;
    /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
    aTag;
    // @ts-ignore
    const __VLS_429 = __VLS_asFunctionalComponent(__VLS_428, new __VLS_428({
        color: "blue",
    }));
    const __VLS_430 = __VLS_429({
        color: "blue",
    }, ...__VLS_functionalComponentArgsRest(__VLS_429));
    const { default: __VLS_433 } = __VLS_431.slots;
    (__VLS_ctx.descriptor.profile);
    // @ts-ignore
    [descriptor, descriptor, descriptor,];
    var __VLS_431;
    __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    let __VLS_434;
    /** @ts-ignore @type {typeof ___VLS_components.aInput | typeof ___VLS_components.AInput} */
    aInput;
    // @ts-ignore
    const __VLS_435 = __VLS_asFunctionalComponent(__VLS_434, new __VLS_434({
        value: (__VLS_ctx.descriptor.defaultSorting),
    }));
    const __VLS_436 = __VLS_435({
        value: (__VLS_ctx.descriptor.defaultSorting),
    }, ...__VLS_functionalComponentArgsRest(__VLS_435));
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "inspector-section" },
    });
    /** @type {__VLS_StyleScopedClasses['inspector-section']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "switch-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['switch-grid']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_439;
    /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
    aSwitch;
    // @ts-ignore
    const __VLS_440 = __VLS_asFunctionalComponent(__VLS_439, new __VLS_439({
        checked: (__VLS_ctx.descriptor.crud.get),
        size: "small",
    }));
    const __VLS_441 = __VLS_440({
        checked: (__VLS_ctx.descriptor.crud.get),
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_440));
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_444;
    /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
    aSwitch;
    // @ts-ignore
    const __VLS_445 = __VLS_asFunctionalComponent(__VLS_444, new __VLS_444({
        checked: (__VLS_ctx.descriptor.crud.getList),
        size: "small",
    }));
    const __VLS_446 = __VLS_445({
        checked: (__VLS_ctx.descriptor.crud.getList),
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_445));
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_449;
    /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
    aSwitch;
    // @ts-ignore
    const __VLS_450 = __VLS_asFunctionalComponent(__VLS_449, new __VLS_449({
        checked: (__VLS_ctx.descriptor.crud.create),
        size: "small",
    }));
    const __VLS_451 = __VLS_450({
        checked: (__VLS_ctx.descriptor.crud.create),
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_450));
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_454;
    /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
    aSwitch;
    // @ts-ignore
    const __VLS_455 = __VLS_asFunctionalComponent(__VLS_454, new __VLS_454({
        checked: (__VLS_ctx.descriptor.crud.update),
        size: "small",
    }));
    const __VLS_456 = __VLS_455({
        checked: (__VLS_ctx.descriptor.crud.update),
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_455));
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_459;
    /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
    aSwitch;
    // @ts-ignore
    const __VLS_460 = __VLS_asFunctionalComponent(__VLS_459, new __VLS_459({
        checked: (__VLS_ctx.descriptor.crud.delete),
        size: "small",
    }));
    const __VLS_461 = __VLS_460({
        checked: (__VLS_ctx.descriptor.crud.delete),
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_460));
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_464;
    /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
    aSwitch;
    // @ts-ignore
    const __VLS_465 = __VLS_asFunctionalComponent(__VLS_464, new __VLS_464({
        checked: (__VLS_ctx.descriptor.permissions.enabled),
        size: "small",
    }));
    const __VLS_466 = __VLS_465({
        checked: (__VLS_ctx.descriptor.permissions.enabled),
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_465));
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "inspector-section plan-summary" },
    });
    /** @type {__VLS_StyleScopedClasses['inspector-section']} */ ;
    /** @type {__VLS_StyleScopedClasses['plan-summary']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
    let __VLS_469;
    /** @ts-ignore @type {typeof ___VLS_components.aBadge | typeof ___VLS_components.ABadge} */
    aBadge;
    // @ts-ignore
    const __VLS_470 = __VLS_asFunctionalComponent(__VLS_469, new __VLS_469({
        status: (__VLS_ctx.statusColor),
        text: (__VLS_ctx.statusText),
    }));
    const __VLS_471 = __VLS_470({
        status: (__VLS_ctx.statusColor),
        text: (__VLS_ctx.statusText),
    }, ...__VLS_functionalComponentArgsRest(__VLS_470));
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "count-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['count-grid']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.planFiles.filter(file => file.action === 'Create').length);
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.planFiles.filter(file => file.action === 'Update').length);
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({
        ...{ class: "danger" },
    });
    /** @type {__VLS_StyleScopedClasses['danger']} */ ;
    (__VLS_ctx.planFiles.filter(file => file.action === 'Conflict').length);
    if (__VLS_ctx.selectedFile?.action === 'Conflict') {
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "inspector-section conflict" },
        });
        /** @type {__VLS_StyleScopedClasses['inspector-section']} */ ;
        /** @type {__VLS_StyleScopedClasses['conflict']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.selectedFile.diff);
        let __VLS_474;
        /** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
        aButton;
        // @ts-ignore
        const __VLS_475 = __VLS_asFunctionalComponent(__VLS_474, new __VLS_474({
            ...{ 'onClick': {} },
            block: true,
        }));
        const __VLS_476 = __VLS_475({
            ...{ 'onClick': {} },
            block: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_475));
        let __VLS_479;
        const __VLS_480 = ({ click: {} },
            { onClick: (...[$event]) => {
                    if (!(__VLS_ctx.descriptor))
                        return;
                    if (!(__VLS_ctx.selectedFile?.action === 'Conflict'))
                        return;
                    __VLS_ctx.keepCurrent(__VLS_ctx.selectedFile.path);
                    // @ts-ignore
                    [statusColor, statusText, descriptor, descriptor, descriptor, descriptor, descriptor, descriptor, descriptor, planFiles, planFiles, planFiles, selectedFile, selectedFile, selectedFile, keepCurrent,];
                } });
        const { default: __VLS_481 } = __VLS_477.slots;
        // @ts-ignore
        [];
        var __VLS_477;
        var __VLS_478;
        let __VLS_482;
        /** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
        aButton;
        // @ts-ignore
        const __VLS_483 = __VLS_asFunctionalComponent(__VLS_482, new __VLS_482({
            ...{ 'onClick': {} },
            block: true,
            danger: true,
        }));
        const __VLS_484 = __VLS_483({
            ...{ 'onClick': {} },
            block: true,
            danger: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_483));
        let __VLS_487;
        const __VLS_488 = ({ click: {} },
            { onClick: (...[$event]) => {
                    if (!(__VLS_ctx.descriptor))
                        return;
                    if (!(__VLS_ctx.selectedFile?.action === 'Conflict'))
                        return;
                    __VLS_ctx.overwriteCurrent(__VLS_ctx.selectedFile.path);
                    // @ts-ignore
                    [selectedFile, overwriteCurrent,];
                } });
        const { default: __VLS_489 } = __VLS_485.slots;
        // @ts-ignore
        [];
        var __VLS_485;
        var __VLS_486;
    }
}
// @ts-ignore
[];
var __VLS_425;
// @ts-ignore
[];
var __VLS_80;
// @ts-ignore
[];
var __VLS_35;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "bottom-panel" },
    ...{ class: ({ collapsed: !__VLS_ctx.bottomVisible }) },
});
/** @type {__VLS_StyleScopedClasses['bottom-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['collapsed']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "bottom-tabs" },
});
/** @type {__VLS_StyleScopedClasses['bottom-tabs']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement(__VLS_intrinsics.button, __VLS_intrinsics.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.bottomVisible = !__VLS_ctx.bottomVisible;
            // @ts-ignore
            [bottomVisible, bottomVisible, bottomVisible,];
        } },
});
(__VLS_ctx.bottomVisible ? '⌄' : '⌃');
if (__VLS_ctx.bottomVisible) {
    __VLS_asFunctionalElement(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({
        ...{ class: "log" },
    });
    /** @type {__VLS_StyleScopedClasses['log']} */ ;
    (__VLS_ctx.logs.length ? __VLS_ctx.logs.join('\n') : '准备就绪。创建生成计划后，可在这里查看验证与写入日志。');
}
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "statusbar" },
});
/** @type {__VLS_StyleScopedClasses['statusbar']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
(__VLS_ctx.selectedEntity ? `实体：${__VLS_ctx.selectedEntity}` : '未选择实体');
__VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
(__VLS_ctx.project);
// @ts-ignore
[project, selectedEntity, selectedEntity, bottomVisible, bottomVisible, logs, logs,];
var __VLS_3;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
