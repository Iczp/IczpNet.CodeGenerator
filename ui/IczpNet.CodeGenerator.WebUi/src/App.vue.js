import { computed, onMounted, ref, watch } from 'vue';
const entities = ref([]), project = ref(''), selectedEntity = ref(), sourceProperties = ref([]), descriptor = ref(), format = ref('yaml'), raw = ref(''), plan = ref(), selectedPath = ref(), loading = ref(false), saving = ref(false), error = ref(''), logs = ref([]), ignoredPaths = ref([]), overwritePaths = ref([]);
let hydrating = false;
let saveTimer;
const editableProperties = computed(() => sourceProperties.value.filter(property => !property.isSystemManaged));
const selectedFile = computed(() => plan.value?.files.find(file => file.path === selectedPath.value));
async function api(url, options) { const response = await fetch(url, options); if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? response.statusText);
} return response.json(); }
function normalize(value, properties) { value.properties ??= {}; for (const property of properties.filter(item => !item.isSystemManaged))
    value.properties[property.name] ??= {}; return value; }
async function loadEntities() { loading.value = true; try {
    project.value = (await api('/api/project')).project;
    entities.value = await api('/api/entities');
    selectedEntity.value ??= entities.value[0]?.name;
}
catch (reason) {
    error.value = String(reason);
}
finally {
    loading.value = false;
} }
async function loadDescriptor() { if (!selectedEntity.value)
    return; loading.value = true; error.value = ''; try {
    const response = await api(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor`);
    hydrating = true;
    sourceProperties.value = response.sourceProperties;
    descriptor.value = normalize(response.descriptor, response.sourceProperties);
    format.value = response.format;
    raw.value = response.raw;
    plan.value = undefined;
}
catch (reason) {
    error.value = String(reason);
}
finally {
    hydrating = false;
    loading.value = false;
} }
async function createPlan() { if (!selectedEntity.value)
    return; plan.value = await api('/api/generation/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entity: selectedEntity.value }) }); selectedPath.value = plan.value.files[0]?.path; }
async function execute(action) {
    if (!selectedEntity.value)
        return;
    loading.value = true;
    error.value = '';
    try {
        const response = await api(`/api/generation/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entity: selectedEntity.value, ignoredPaths: ignoredPaths.value, overwritePaths: overwritePaths.value }) });
        logs.value = response.logs ?? [`${action} completed.`];
        plan.value = response.plan;
        selectedPath.value = plan.value?.files[0]?.path;
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
async function saveDescriptor() { if (!selectedEntity.value || !descriptor.value || hydrating)
    return; saving.value = true; error.value = ''; try {
    const response = await api(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descriptor: descriptor.value, format: format.value }) });
    hydrating = true;
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
} }
async function saveRaw() { if (!selectedEntity.value)
    return; saving.value = true; error.value = ''; try {
    const response = await api(`/api/entities/${encodeURIComponent(selectedEntity.value)}/descriptor/raw`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: raw.value, format: format.value }) });
    hydrating = true;
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
} }
function selectEntity({ key }) { selectedEntity.value = String(key); }
function typeHint(property) { if (property.name.endsWith('Id'))
    return '引用候选'; if (property.typeName.endsWith('Status') || property.typeName.endsWith('Type'))
    return '枚举候选'; return ''; }
function diffLines(current, generated) {
    const left = (current ?? '').split('\n');
    const right = (generated ?? '').split('\n');
    const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = left.length - 1; i >= 0; i--)
        for (let j = right.length - 1; j >= 0; j--)
            matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    const result = [];
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
        if (i < left.length && j < right.length && left[i] === right[j]) {
            result.push({ current: left[i++], generated: right[j++], state: 'same' });
        }
        else if (j < right.length && (i === left.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
            result.push({ current: '', generated: right[j++], state: 'added' });
        }
        else {
            result.push({ current: left[i++], generated: '', state: 'removed' });
        }
    }
    return result;
}
function keepCurrent(path) { if (!ignoredPaths.value.includes(path))
    ignoredPaths.value.push(path); overwritePaths.value = overwritePaths.value.filter(item => item !== path); }
function overwriteCurrent(path) { if (!overwritePaths.value.includes(path))
    overwritePaths.value.push(path); ignoredPaths.value = ignoredPaths.value.filter(item => item !== path); }
watch(selectedEntity, loadDescriptor);
watch(descriptor, () => { if (hydrating || !descriptor.value)
    return; window.clearTimeout(saveTimer); saveTimer = window.setTimeout(saveDescriptor, 600); }, { deep: true });
onMounted(loadEntities);
const __VLS_ctx = {
    ...{},
    ...{},
};
let ___VLS_components;
let ___VLS_directives;
/** @type {__VLS_StyleScopedClasses['studio']} */ ;
/** @type {__VLS_StyleScopedClasses['project']} */ ;
if (__VLS_ctx.logs.length) {
    let __VLS_0;
    /** @ts-ignore @type {typeof ___VLS_components.aCard | typeof ___VLS_components.ACard} */
    aCard;
    // @ts-ignore
    const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
        title: "执行日志",
        size: "small",
    }));
    const __VLS_2 = __VLS_1({
        title: "执行日志",
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    const { default: __VLS_5 } = __VLS_3.slots;
    __VLS_asFunctionalElement(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({
        ...{ class: "log" },
    });
    /** @type {__VLS_StyleScopedClasses['log']} */ ;
    (__VLS_ctx.logs.join('\n'));
    // @ts-ignore
    [logs, logs,];
    var __VLS_3;
}
if (__VLS_ctx.selectedFile?.action === 'Conflict') {
    let __VLS_6;
    /** @ts-ignore @type {typeof ___VLS_components.aCard | typeof ___VLS_components.ACard} */
    aCard;
    // @ts-ignore
    const __VLS_7 = __VLS_asFunctionalComponent(__VLS_6, new __VLS_6({
        title: "冲突处理",
        size: "small",
    }));
    const __VLS_8 = __VLS_7({
        title: "冲突处理",
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_7));
    const { default: __VLS_11 } = __VLS_9.slots;
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.selectedFile.diff);
    let __VLS_12;
    /** @ts-ignore @type {typeof ___VLS_components.aSpace | typeof ___VLS_components.ASpace} */
    aSpace;
    // @ts-ignore
    const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({}));
    const __VLS_14 = __VLS_13({}, ...__VLS_functionalComponentArgsRest(__VLS_13));
    const { default: __VLS_17 } = __VLS_15.slots;
    let __VLS_18;
    /** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
    aButton;
    // @ts-ignore
    const __VLS_19 = __VLS_asFunctionalComponent(__VLS_18, new __VLS_18({
        ...{ 'onClick': {} },
    }));
    const __VLS_20 = __VLS_19({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_19));
    let __VLS_23;
    const __VLS_24 = ({ click: {} },
        { onClick: (...[$event]) => {
                if (!(__VLS_ctx.selectedFile?.action === 'Conflict'))
                    return;
                __VLS_ctx.keepCurrent(__VLS_ctx.selectedFile.path);
                // @ts-ignore
                [selectedFile, selectedFile, selectedFile, keepCurrent,];
            } });
    const { default: __VLS_25 } = __VLS_21.slots;
    // @ts-ignore
    [];
    var __VLS_21;
    var __VLS_22;
    let __VLS_26;
    /** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
    aButton;
    // @ts-ignore
    const __VLS_27 = __VLS_asFunctionalComponent(__VLS_26, new __VLS_26({
        ...{ 'onClick': {} },
        danger: true,
    }));
    const __VLS_28 = __VLS_27({
        ...{ 'onClick': {} },
        danger: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_27));
    let __VLS_31;
    const __VLS_32 = ({ click: {} },
        { onClick: (...[$event]) => {
                if (!(__VLS_ctx.selectedFile?.action === 'Conflict'))
                    return;
                __VLS_ctx.overwriteCurrent(__VLS_ctx.selectedFile.path);
                // @ts-ignore
                [selectedFile, overwriteCurrent,];
            } });
    const { default: __VLS_33 } = __VLS_29.slots;
    // @ts-ignore
    [];
    var __VLS_29;
    var __VLS_30;
    // @ts-ignore
    [];
    var __VLS_15;
    // @ts-ignore
    [];
    var __VLS_9;
}
if (__VLS_ctx.selectedFile?.currentContent) {
    let __VLS_34;
    /** @ts-ignore @type {typeof ___VLS_components.aCard | typeof ___VLS_components.ACard} */
    aCard;
    // @ts-ignore
    const __VLS_35 = __VLS_asFunctionalComponent(__VLS_34, new __VLS_34({
        title: "行级 Diff",
        size: "small",
    }));
    const __VLS_36 = __VLS_35({
        title: "行级 Diff",
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_35));
    const { default: __VLS_39 } = __VLS_37.slots;
    for (const [line, index] of __VLS_getVForSourceType((__VLS_ctx.diffLines(__VLS_ctx.selectedFile.currentContent, __VLS_ctx.selectedFile.content)))) {
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (index),
            ...{ class: (['diff-line', line.state]) },
        });
        /** @type {__VLS_StyleScopedClasses['diff-line']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
        (line.current);
        __VLS_asFunctionalElement(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
        (line.generated);
        // @ts-ignore
        [selectedFile, selectedFile, selectedFile, diffLines,];
    }
    // @ts-ignore
    [];
    var __VLS_37;
}
let __VLS_40;
/** @ts-ignore @type {typeof ___VLS_components.aLayout | typeof ___VLS_components.ALayout} */
aLayout;
// @ts-ignore
const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
    ...{ class: "studio" },
}));
const __VLS_42 = __VLS_41({
    ...{ class: "studio" },
}, ...__VLS_functionalComponentArgsRest(__VLS_41));
/** @type {__VLS_StyleScopedClasses['studio']} */ ;
const { default: __VLS_45 } = __VLS_43.slots;
let __VLS_46;
/** @ts-ignore @type {typeof ___VLS_components.aLayoutSider | typeof ___VLS_components.ALayoutSider} */
aLayoutSider;
// @ts-ignore
const __VLS_47 = __VLS_asFunctionalComponent(__VLS_46, new __VLS_46({
    width: "280",
    theme: "light",
}));
const __VLS_48 = __VLS_47({
    width: "280",
    theme: "light",
}, ...__VLS_functionalComponentArgsRest(__VLS_47));
const { default: __VLS_51 } = __VLS_49.slots;
__VLS_asFunctionalElement(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
__VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "project" },
});
/** @type {__VLS_StyleScopedClasses['project']} */ ;
(__VLS_ctx.project);
let __VLS_52;
/** @ts-ignore @type {typeof ___VLS_components.aMenu | typeof ___VLS_components.AMenu} */
aMenu;
// @ts-ignore
const __VLS_53 = __VLS_asFunctionalComponent(__VLS_52, new __VLS_52({
    ...{ 'onClick': {} },
    selectedKeys: (__VLS_ctx.selectedEntity ? [__VLS_ctx.selectedEntity] : []),
    mode: "inline",
}));
const __VLS_54 = __VLS_53({
    ...{ 'onClick': {} },
    selectedKeys: (__VLS_ctx.selectedEntity ? [__VLS_ctx.selectedEntity] : []),
    mode: "inline",
}, ...__VLS_functionalComponentArgsRest(__VLS_53));
let __VLS_57;
const __VLS_58 = ({ click: {} },
    { onClick: (__VLS_ctx.selectEntity) });
const { default: __VLS_59 } = __VLS_55.slots;
for (const [entity] of __VLS_getVForSourceType((__VLS_ctx.entities))) {
    let __VLS_60;
    /** @ts-ignore @type {typeof ___VLS_components.aMenuItem | typeof ___VLS_components.AMenuItem} */
    aMenuItem;
    // @ts-ignore
    const __VLS_61 = __VLS_asFunctionalComponent(__VLS_60, new __VLS_60({
        key: (entity.name),
    }));
    const __VLS_62 = __VLS_61({
        key: (entity.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_61));
    const { default: __VLS_65 } = __VLS_63.slots;
    (entity.fullName);
    // @ts-ignore
    [project, selectedEntity, selectedEntity, selectEntity, entities,];
    var __VLS_63;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_55;
var __VLS_56;
// @ts-ignore
[];
var __VLS_49;
let __VLS_66;
/** @ts-ignore @type {typeof ___VLS_components.aLayoutContent | typeof ___VLS_components.ALayoutContent} */
aLayoutContent;
// @ts-ignore
const __VLS_67 = __VLS_asFunctionalComponent(__VLS_66, new __VLS_66({
    ...{ class: "content" },
}));
const __VLS_68 = __VLS_67({
    ...{ class: "content" },
}, ...__VLS_functionalComponentArgsRest(__VLS_67));
/** @type {__VLS_StyleScopedClasses['content']} */ ;
const { default: __VLS_71 } = __VLS_69.slots;
if (__VLS_ctx.error) {
    let __VLS_72;
    /** @ts-ignore @type {typeof ___VLS_components.aAlert | typeof ___VLS_components.AAlert} */
    aAlert;
    // @ts-ignore
    const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
        type: "error",
        showIcon: true,
        message: (__VLS_ctx.error),
        ...{ class: "alert" },
    }));
    const __VLS_74 = __VLS_73({
        type: "error",
        showIcon: true,
        message: (__VLS_ctx.error),
        ...{ class: "alert" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_73));
    /** @type {__VLS_StyleScopedClasses['alert']} */ ;
}
let __VLS_77;
/** @ts-ignore @type {typeof ___VLS_components.aSpace | typeof ___VLS_components.ASpace} */
aSpace;
// @ts-ignore
const __VLS_78 = __VLS_asFunctionalComponent(__VLS_77, new __VLS_77({}));
const __VLS_79 = __VLS_78({}, ...__VLS_functionalComponentArgsRest(__VLS_78));
const { default: __VLS_82 } = __VLS_80.slots;
let __VLS_83;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_84 = __VLS_asFunctionalComponent(__VLS_83, new __VLS_83({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading || __VLS_ctx.saving),
    type: "primary",
}));
const __VLS_85 = __VLS_84({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading || __VLS_ctx.saving),
    type: "primary",
}, ...__VLS_functionalComponentArgsRest(__VLS_84));
let __VLS_88;
const __VLS_89 = ({ click: {} },
    { onClick: (__VLS_ctx.createPlan) });
const { default: __VLS_90 } = __VLS_86.slots;
// @ts-ignore
[error, error, loading, saving, createPlan,];
var __VLS_86;
var __VLS_87;
let __VLS_91;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_92 = __VLS_asFunctionalComponent(__VLS_91, new __VLS_91({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
    disabled: (!__VLS_ctx.plan || __VLS_ctx.plan.hasConflicts),
}));
const __VLS_93 = __VLS_92({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
    disabled: (!__VLS_ctx.plan || __VLS_ctx.plan.hasConflicts),
}, ...__VLS_functionalComponentArgsRest(__VLS_92));
let __VLS_96;
const __VLS_97 = ({ click: {} },
    { onClick: (...[$event]) => {
            __VLS_ctx.execute('generate');
            // @ts-ignore
            [loading, plan, plan, execute,];
        } });
const { default: __VLS_98 } = __VLS_94.slots;
// @ts-ignore
[];
var __VLS_94;
var __VLS_95;
let __VLS_99;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_100 = __VLS_asFunctionalComponent(__VLS_99, new __VLS_99({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}));
const __VLS_101 = __VLS_100({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}, ...__VLS_functionalComponentArgsRest(__VLS_100));
let __VLS_104;
const __VLS_105 = ({ click: {} },
    { onClick: (...[$event]) => {
            __VLS_ctx.execute('validate');
            // @ts-ignore
            [loading, execute,];
        } });
const { default: __VLS_106 } = __VLS_102.slots;
// @ts-ignore
[];
var __VLS_102;
var __VLS_103;
let __VLS_107;
/** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
aButton;
// @ts-ignore
const __VLS_108 = __VLS_asFunctionalComponent(__VLS_107, new __VLS_107({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}));
const __VLS_109 = __VLS_108({
    ...{ 'onClick': {} },
    loading: (__VLS_ctx.loading),
}, ...__VLS_functionalComponentArgsRest(__VLS_108));
let __VLS_112;
const __VLS_113 = ({ click: {} },
    { onClick: (...[$event]) => {
            __VLS_ctx.execute('format');
            // @ts-ignore
            [loading, execute,];
        } });
const { default: __VLS_114 } = __VLS_110.slots;
// @ts-ignore
[];
var __VLS_110;
var __VLS_111;
if (__VLS_ctx.saving) {
    let __VLS_115;
    /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
    aTag;
    // @ts-ignore
    const __VLS_116 = __VLS_asFunctionalComponent(__VLS_115, new __VLS_115({
        color: "processing",
    }));
    const __VLS_117 = __VLS_116({
        color: "processing",
    }, ...__VLS_functionalComponentArgsRest(__VLS_116));
    const { default: __VLS_120 } = __VLS_118.slots;
    // @ts-ignore
    [saving,];
    var __VLS_118;
}
if (__VLS_ctx.plan) {
    let __VLS_121;
    /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
    aTag;
    // @ts-ignore
    const __VLS_122 = __VLS_asFunctionalComponent(__VLS_121, new __VLS_121({
        color: (__VLS_ctx.plan.hasConflicts ? 'red' : 'green'),
    }));
    const __VLS_123 = __VLS_122({
        color: (__VLS_ctx.plan.hasConflicts ? 'red' : 'green'),
    }, ...__VLS_functionalComponentArgsRest(__VLS_122));
    const { default: __VLS_126 } = __VLS_124.slots;
    (__VLS_ctx.plan.hasConflicts ? '存在冲突' : '可安全生成');
    // @ts-ignore
    [plan, plan, plan,];
    var __VLS_124;
}
// @ts-ignore
[];
var __VLS_80;
if (__VLS_ctx.descriptor) {
    let __VLS_127;
    /** @ts-ignore @type {typeof ___VLS_components.aTabs | typeof ___VLS_components.ATabs} */
    aTabs;
    // @ts-ignore
    const __VLS_128 = __VLS_asFunctionalComponent(__VLS_127, new __VLS_127({
        ...{ class: "top-tabs" },
    }));
    const __VLS_129 = __VLS_128({
        ...{ class: "top-tabs" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_128));
    /** @type {__VLS_StyleScopedClasses['top-tabs']} */ ;
    const { default: __VLS_132 } = __VLS_130.slots;
    let __VLS_133;
    /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
    aTabPane;
    // @ts-ignore
    const __VLS_134 = __VLS_asFunctionalComponent(__VLS_133, new __VLS_133({
        key: "properties",
        tab: "属性元数据",
    }));
    const __VLS_135 = __VLS_134({
        key: "properties",
        tab: "属性元数据",
    }, ...__VLS_functionalComponentArgsRest(__VLS_134));
    const { default: __VLS_138 } = __VLS_136.slots;
    let __VLS_139;
    /** @ts-ignore @type {typeof ___VLS_components.aAlert | typeof ___VLS_components.AAlert} */
    aAlert;
    // @ts-ignore
    const __VLS_140 = __VLS_asFunctionalComponent(__VLS_139, new __VLS_139({
        type: "info",
        showIcon: true,
        message: "类型、可空与系统管理属性来自领域实体，只读；下面的设置仅写入 .codegen.yaml/json。",
    }));
    const __VLS_141 = __VLS_140({
        type: "info",
        showIcon: true,
        message: "类型、可空与系统管理属性来自领域实体，只读；下面的设置仅写入 .codegen.yaml/json。",
    }, ...__VLS_functionalComponentArgsRest(__VLS_140));
    let __VLS_144;
    /** @ts-ignore @type {typeof ___VLS_components.aTable | typeof ___VLS_components.ATable} */
    aTable;
    // @ts-ignore
    const __VLS_145 = __VLS_asFunctionalComponent(__VLS_144, new __VLS_144({
        dataSource: (__VLS_ctx.editableProperties),
        pagination: (false),
        rowKey: "name",
        size: "small",
        scroll: ({ x: 1500 }),
        ...{ class: "property-table" },
    }));
    const __VLS_146 = __VLS_145({
        dataSource: (__VLS_ctx.editableProperties),
        pagination: (false),
        rowKey: "name",
        size: "small",
        scroll: ({ x: 1500 }),
        ...{ class: "property-table" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_145));
    /** @type {__VLS_StyleScopedClasses['property-table']} */ ;
    const { default: __VLS_149 } = __VLS_147.slots;
    let __VLS_150;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_151 = __VLS_asFunctionalComponent(__VLS_150, new __VLS_150({
        title: "属性",
        dataIndex: "name",
        width: (150),
        fixed: "left",
    }));
    const __VLS_152 = __VLS_151({
        title: "属性",
        dataIndex: "name",
        width: (150),
        fixed: "left",
    }, ...__VLS_functionalComponentArgsRest(__VLS_151));
    let __VLS_155;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_156 = __VLS_asFunctionalComponent(__VLS_155, new __VLS_155({
        title: "源码类型",
        width: (150),
    }));
    const __VLS_157 = __VLS_156({
        title: "源码类型",
        width: (150),
    }, ...__VLS_functionalComponentArgsRest(__VLS_156));
    const { default: __VLS_160 } = __VLS_158.slots;
    {
        const { default: __VLS_161 } = __VLS_158.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_161);
        let __VLS_162;
        /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
        aTag;
        // @ts-ignore
        const __VLS_163 = __VLS_asFunctionalComponent(__VLS_162, new __VLS_162({}));
        const __VLS_164 = __VLS_163({}, ...__VLS_functionalComponentArgsRest(__VLS_163));
        const { default: __VLS_167 } = __VLS_165.slots;
        (record.typeName);
        // @ts-ignore
        [descriptor, editableProperties,];
        var __VLS_165;
        if (record.isNullable) {
            let __VLS_168;
            /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
            aTag;
            // @ts-ignore
            const __VLS_169 = __VLS_asFunctionalComponent(__VLS_168, new __VLS_168({}));
            const __VLS_170 = __VLS_169({}, ...__VLS_functionalComponentArgsRest(__VLS_169));
            const { default: __VLS_173 } = __VLS_171.slots;
            // @ts-ignore
            [];
            var __VLS_171;
        }
        if (__VLS_ctx.typeHint(record)) {
            let __VLS_174;
            /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
            aTag;
            // @ts-ignore
            const __VLS_175 = __VLS_asFunctionalComponent(__VLS_174, new __VLS_174({
                color: "purple",
            }));
            const __VLS_176 = __VLS_175({
                color: "purple",
            }, ...__VLS_functionalComponentArgsRest(__VLS_175));
            const { default: __VLS_179 } = __VLS_177.slots;
            (__VLS_ctx.typeHint(record));
            // @ts-ignore
            [typeHint, typeHint,];
            var __VLS_177;
        }
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_158;
    let __VLS_180;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_181 = __VLS_asFunctionalComponent(__VLS_180, new __VLS_180({
        title: "展示名",
        width: (150),
    }));
    const __VLS_182 = __VLS_181({
        title: "展示名",
        width: (150),
    }, ...__VLS_functionalComponentArgsRest(__VLS_181));
    const { default: __VLS_185 } = __VLS_183.slots;
    {
        const { default: __VLS_186 } = __VLS_183.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_186);
        let __VLS_187;
        /** @ts-ignore @type {typeof ___VLS_components.aInput | typeof ___VLS_components.AInput} */
        aInput;
        // @ts-ignore
        const __VLS_188 = __VLS_asFunctionalComponent(__VLS_187, new __VLS_187({
            value: (__VLS_ctx.descriptor.properties[record.name].displayName),
        }));
        const __VLS_189 = __VLS_188({
            value: (__VLS_ctx.descriptor.properties[record.name].displayName),
        }, ...__VLS_functionalComponentArgsRest(__VLS_188));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_183;
    let __VLS_192;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_193 = __VLS_asFunctionalComponent(__VLS_192, new __VLS_192({
        title: "说明",
        width: (180),
    }));
    const __VLS_194 = __VLS_193({
        title: "说明",
        width: (180),
    }, ...__VLS_functionalComponentArgsRest(__VLS_193));
    const { default: __VLS_197 } = __VLS_195.slots;
    {
        const { default: __VLS_198 } = __VLS_195.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_198);
        let __VLS_199;
        /** @ts-ignore @type {typeof ___VLS_components.aInput | typeof ___VLS_components.AInput} */
        aInput;
        // @ts-ignore
        const __VLS_200 = __VLS_asFunctionalComponent(__VLS_199, new __VLS_199({
            value: (__VLS_ctx.descriptor.properties[record.name].description),
        }));
        const __VLS_201 = __VLS_200({
            value: (__VLS_ctx.descriptor.properties[record.name].description),
        }, ...__VLS_functionalComponentArgsRest(__VLS_200));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_195;
    let __VLS_204;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_205 = __VLS_asFunctionalComponent(__VLS_204, new __VLS_204({
        title: "必填",
        width: (70),
    }));
    const __VLS_206 = __VLS_205({
        title: "必填",
        width: (70),
    }, ...__VLS_functionalComponentArgsRest(__VLS_205));
    const { default: __VLS_209 } = __VLS_207.slots;
    {
        const { default: __VLS_210 } = __VLS_207.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_210);
        let __VLS_211;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_212 = __VLS_asFunctionalComponent(__VLS_211, new __VLS_211({
            checked: (__VLS_ctx.descriptor.properties[record.name].required),
        }));
        const __VLS_213 = __VLS_212({
            checked: (__VLS_ctx.descriptor.properties[record.name].required),
        }, ...__VLS_functionalComponentArgsRest(__VLS_212));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_207;
    let __VLS_216;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_217 = __VLS_asFunctionalComponent(__VLS_216, new __VLS_216({
        title: "长度",
        width: (90),
    }));
    const __VLS_218 = __VLS_217({
        title: "长度",
        width: (90),
    }, ...__VLS_functionalComponentArgsRest(__VLS_217));
    const { default: __VLS_221 } = __VLS_219.slots;
    {
        const { default: __VLS_222 } = __VLS_219.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_222);
        let __VLS_223;
        /** @ts-ignore @type {typeof ___VLS_components.aInputNumber | typeof ___VLS_components.AInputNumber} */
        aInputNumber;
        // @ts-ignore
        const __VLS_224 = __VLS_asFunctionalComponent(__VLS_223, new __VLS_223({
            value: (__VLS_ctx.descriptor.properties[record.name].maxLength),
            min: (1),
        }));
        const __VLS_225 = __VLS_224({
            value: (__VLS_ctx.descriptor.properties[record.name].maxLength),
            min: (1),
        }, ...__VLS_functionalComponentArgsRest(__VLS_224));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_219;
    let __VLS_228;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_229 = __VLS_asFunctionalComponent(__VLS_228, new __VLS_228({
        title: "默认值",
        width: (120),
    }));
    const __VLS_230 = __VLS_229({
        title: "默认值",
        width: (120),
    }, ...__VLS_functionalComponentArgsRest(__VLS_229));
    const { default: __VLS_233 } = __VLS_231.slots;
    {
        const { default: __VLS_234 } = __VLS_231.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_234);
        let __VLS_235;
        /** @ts-ignore @type {typeof ___VLS_components.aInput | typeof ___VLS_components.AInput} */
        aInput;
        // @ts-ignore
        const __VLS_236 = __VLS_asFunctionalComponent(__VLS_235, new __VLS_235({
            value: (__VLS_ctx.descriptor.properties[record.name].defaultValue),
        }));
        const __VLS_237 = __VLS_236({
            value: (__VLS_ctx.descriptor.properties[record.name].defaultValue),
        }, ...__VLS_functionalComponentArgsRest(__VLS_236));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_231;
    let __VLS_240;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_241 = __VLS_asFunctionalComponent(__VLS_240, new __VLS_240({
        title: "DTO",
        width: (65),
    }));
    const __VLS_242 = __VLS_241({
        title: "DTO",
        width: (65),
    }, ...__VLS_functionalComponentArgsRest(__VLS_241));
    const { default: __VLS_245 } = __VLS_243.slots;
    {
        const { default: __VLS_246 } = __VLS_243.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_246);
        let __VLS_247;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_248 = __VLS_asFunctionalComponent(__VLS_247, new __VLS_247({
            checked: (__VLS_ctx.descriptor.properties[record.name].dto),
        }));
        const __VLS_249 = __VLS_248({
            checked: (__VLS_ctx.descriptor.properties[record.name].dto),
        }, ...__VLS_functionalComponentArgsRest(__VLS_248));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_243;
    let __VLS_252;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_253 = __VLS_asFunctionalComponent(__VLS_252, new __VLS_252({
        title: "创建",
        width: (65),
    }));
    const __VLS_254 = __VLS_253({
        title: "创建",
        width: (65),
    }, ...__VLS_functionalComponentArgsRest(__VLS_253));
    const { default: __VLS_257 } = __VLS_255.slots;
    {
        const { default: __VLS_258 } = __VLS_255.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_258);
        let __VLS_259;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_260 = __VLS_asFunctionalComponent(__VLS_259, new __VLS_259({
            checked: (__VLS_ctx.descriptor.properties[record.name].create),
        }));
        const __VLS_261 = __VLS_260({
            checked: (__VLS_ctx.descriptor.properties[record.name].create),
        }, ...__VLS_functionalComponentArgsRest(__VLS_260));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_255;
    let __VLS_264;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_265 = __VLS_asFunctionalComponent(__VLS_264, new __VLS_264({
        title: "更新",
        width: (65),
    }));
    const __VLS_266 = __VLS_265({
        title: "更新",
        width: (65),
    }, ...__VLS_functionalComponentArgsRest(__VLS_265));
    const { default: __VLS_269 } = __VLS_267.slots;
    {
        const { default: __VLS_270 } = __VLS_267.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_270);
        let __VLS_271;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_272 = __VLS_asFunctionalComponent(__VLS_271, new __VLS_271({
            checked: (__VLS_ctx.descriptor.properties[record.name].update),
        }));
        const __VLS_273 = __VLS_272({
            checked: (__VLS_ctx.descriptor.properties[record.name].update),
        }, ...__VLS_functionalComponentArgsRest(__VLS_272));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_267;
    let __VLS_276;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_277 = __VLS_asFunctionalComponent(__VLS_276, new __VLS_276({
        title: "筛选",
        width: (120),
    }));
    const __VLS_278 = __VLS_277({
        title: "筛选",
        width: (120),
    }, ...__VLS_functionalComponentArgsRest(__VLS_277));
    const { default: __VLS_281 } = __VLS_279.slots;
    {
        const { default: __VLS_282 } = __VLS_279.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_282);
        let __VLS_283;
        /** @ts-ignore @type {typeof ___VLS_components.aSelect | typeof ___VLS_components.ASelect} */
        aSelect;
        // @ts-ignore
        const __VLS_284 = __VLS_asFunctionalComponent(__VLS_283, new __VLS_283({
            value: (__VLS_ctx.descriptor.properties[record.name].filter),
            allowClear: true,
        }));
        const __VLS_285 = __VLS_284({
            value: (__VLS_ctx.descriptor.properties[record.name].filter),
            allowClear: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_284));
        const { default: __VLS_288 } = __VLS_286.slots;
        let __VLS_289;
        /** @ts-ignore @type {typeof ___VLS_components.aSelectOption | typeof ___VLS_components.ASelectOption} */
        aSelectOption;
        // @ts-ignore
        const __VLS_290 = __VLS_asFunctionalComponent(__VLS_289, new __VLS_289({
            value: "contains",
        }));
        const __VLS_291 = __VLS_290({
            value: "contains",
        }, ...__VLS_functionalComponentArgsRest(__VLS_290));
        const { default: __VLS_294 } = __VLS_292.slots;
        // @ts-ignore
        [descriptor,];
        var __VLS_292;
        let __VLS_295;
        /** @ts-ignore @type {typeof ___VLS_components.aSelectOption | typeof ___VLS_components.ASelectOption} */
        aSelectOption;
        // @ts-ignore
        const __VLS_296 = __VLS_asFunctionalComponent(__VLS_295, new __VLS_295({
            value: "equals",
        }));
        const __VLS_297 = __VLS_296({
            value: "equals",
        }, ...__VLS_functionalComponentArgsRest(__VLS_296));
        const { default: __VLS_300 } = __VLS_298.slots;
        // @ts-ignore
        [];
        var __VLS_298;
        let __VLS_301;
        /** @ts-ignore @type {typeof ___VLS_components.aSelectOption | typeof ___VLS_components.ASelectOption} */
        aSelectOption;
        // @ts-ignore
        const __VLS_302 = __VLS_asFunctionalComponent(__VLS_301, new __VLS_301({
            value: "range",
        }));
        const __VLS_303 = __VLS_302({
            value: "range",
        }, ...__VLS_functionalComponentArgsRest(__VLS_302));
        const { default: __VLS_306 } = __VLS_304.slots;
        // @ts-ignore
        [];
        var __VLS_304;
        // @ts-ignore
        [];
        var __VLS_286;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_279;
    let __VLS_307;
    /** @ts-ignore @type {typeof ___VLS_components.aTableColumn | typeof ___VLS_components.ATableColumn} */
    aTableColumn;
    // @ts-ignore
    const __VLS_308 = __VLS_asFunctionalComponent(__VLS_307, new __VLS_307({
        title: "排序",
        width: (65),
    }));
    const __VLS_309 = __VLS_308({
        title: "排序",
        width: (65),
    }, ...__VLS_functionalComponentArgsRest(__VLS_308));
    const { default: __VLS_312 } = __VLS_310.slots;
    {
        const { default: __VLS_313 } = __VLS_310.slots;
        const [{ record }] = __VLS_getSlotParameters(__VLS_313);
        let __VLS_314;
        /** @ts-ignore @type {typeof ___VLS_components.aSwitch | typeof ___VLS_components.ASwitch} */
        aSwitch;
        // @ts-ignore
        const __VLS_315 = __VLS_asFunctionalComponent(__VLS_314, new __VLS_314({
            checked: (__VLS_ctx.descriptor.properties[record.name].sortable),
        }));
        const __VLS_316 = __VLS_315({
            checked: (__VLS_ctx.descriptor.properties[record.name].sortable),
        }, ...__VLS_functionalComponentArgsRest(__VLS_315));
        // @ts-ignore
        [descriptor,];
    }
    // @ts-ignore
    [];
    var __VLS_310;
    // @ts-ignore
    [];
    var __VLS_147;
    // @ts-ignore
    [];
    var __VLS_136;
    let __VLS_319;
    /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
    aTabPane;
    // @ts-ignore
    const __VLS_320 = __VLS_asFunctionalComponent(__VLS_319, new __VLS_319({
        key: "advanced",
        tab: "高级原文",
    }));
    const __VLS_321 = __VLS_320({
        key: "advanced",
        tab: "高级原文",
    }, ...__VLS_functionalComponentArgsRest(__VLS_320));
    const { default: __VLS_324 } = __VLS_322.slots;
    let __VLS_325;
    /** @ts-ignore @type {typeof ___VLS_components.aSpace | typeof ___VLS_components.ASpace} */
    aSpace;
    // @ts-ignore
    const __VLS_326 = __VLS_asFunctionalComponent(__VLS_325, new __VLS_325({
        ...{ class: "raw-actions" },
    }));
    const __VLS_327 = __VLS_326({
        ...{ class: "raw-actions" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_326));
    /** @type {__VLS_StyleScopedClasses['raw-actions']} */ ;
    const { default: __VLS_330 } = __VLS_328.slots;
    let __VLS_331;
    /** @ts-ignore @type {typeof ___VLS_components.aRadioGroup | typeof ___VLS_components.ARadioGroup} */
    aRadioGroup;
    // @ts-ignore
    const __VLS_332 = __VLS_asFunctionalComponent(__VLS_331, new __VLS_331({
        value: (__VLS_ctx.format),
    }));
    const __VLS_333 = __VLS_332({
        value: (__VLS_ctx.format),
    }, ...__VLS_functionalComponentArgsRest(__VLS_332));
    const { default: __VLS_336 } = __VLS_334.slots;
    let __VLS_337;
    /** @ts-ignore @type {typeof ___VLS_components.aRadioButton | typeof ___VLS_components.ARadioButton} */
    aRadioButton;
    // @ts-ignore
    const __VLS_338 = __VLS_asFunctionalComponent(__VLS_337, new __VLS_337({
        value: "yaml",
    }));
    const __VLS_339 = __VLS_338({
        value: "yaml",
    }, ...__VLS_functionalComponentArgsRest(__VLS_338));
    const { default: __VLS_342 } = __VLS_340.slots;
    // @ts-ignore
    [format,];
    var __VLS_340;
    let __VLS_343;
    /** @ts-ignore @type {typeof ___VLS_components.aRadioButton | typeof ___VLS_components.ARadioButton} */
    aRadioButton;
    // @ts-ignore
    const __VLS_344 = __VLS_asFunctionalComponent(__VLS_343, new __VLS_343({
        value: "json",
    }));
    const __VLS_345 = __VLS_344({
        value: "json",
    }, ...__VLS_functionalComponentArgsRest(__VLS_344));
    const { default: __VLS_348 } = __VLS_346.slots;
    // @ts-ignore
    [];
    var __VLS_346;
    // @ts-ignore
    [];
    var __VLS_334;
    let __VLS_349;
    /** @ts-ignore @type {typeof ___VLS_components.aButton | typeof ___VLS_components.AButton} */
    aButton;
    // @ts-ignore
    const __VLS_350 = __VLS_asFunctionalComponent(__VLS_349, new __VLS_349({
        ...{ 'onClick': {} },
        loading: (__VLS_ctx.saving),
    }));
    const __VLS_351 = __VLS_350({
        ...{ 'onClick': {} },
        loading: (__VLS_ctx.saving),
    }, ...__VLS_functionalComponentArgsRest(__VLS_350));
    let __VLS_354;
    const __VLS_355 = ({ click: {} },
        { onClick: (__VLS_ctx.saveRaw) });
    const { default: __VLS_356 } = __VLS_352.slots;
    // @ts-ignore
    [saving, saveRaw,];
    var __VLS_352;
    var __VLS_353;
    // @ts-ignore
    [];
    var __VLS_328;
    let __VLS_357;
    /** @ts-ignore @type {typeof ___VLS_components.aTextarea | typeof ___VLS_components.ATextarea} */
    aTextarea;
    // @ts-ignore
    const __VLS_358 = __VLS_asFunctionalComponent(__VLS_357, new __VLS_357({
        value: (__VLS_ctx.raw),
        autoSize: ({ minRows: 18 }),
        ...{ class: "raw-editor" },
    }));
    const __VLS_359 = __VLS_358({
        value: (__VLS_ctx.raw),
        autoSize: ({ minRows: 18 }),
        ...{ class: "raw-editor" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_358));
    /** @type {__VLS_StyleScopedClasses['raw-editor']} */ ;
    // @ts-ignore
    [raw,];
    var __VLS_322;
    // @ts-ignore
    [];
    var __VLS_130;
}
if (!__VLS_ctx.plan) {
    let __VLS_362;
    /** @ts-ignore @type {typeof ___VLS_components.aEmpty | typeof ___VLS_components.AEmpty} */
    aEmpty;
    // @ts-ignore
    const __VLS_363 = __VLS_asFunctionalComponent(__VLS_362, new __VLS_362({
        description: "编辑属性后会自动保存并创建生成计划",
    }));
    const __VLS_364 = __VLS_363({
        description: "编辑属性后会自动保存并创建生成计划",
    }, ...__VLS_functionalComponentArgsRest(__VLS_363));
}
else {
    let __VLS_367;
    /** @ts-ignore @type {typeof ___VLS_components.aRow | typeof ___VLS_components.ARow} */
    aRow;
    // @ts-ignore
    const __VLS_368 = __VLS_asFunctionalComponent(__VLS_367, new __VLS_367({
        gutter: (16),
        ...{ class: "workspace" },
    }));
    const __VLS_369 = __VLS_368({
        gutter: (16),
        ...{ class: "workspace" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_368));
    /** @type {__VLS_StyleScopedClasses['workspace']} */ ;
    const { default: __VLS_372 } = __VLS_370.slots;
    let __VLS_373;
    /** @ts-ignore @type {typeof ___VLS_components.aCol | typeof ___VLS_components.ACol} */
    aCol;
    // @ts-ignore
    const __VLS_374 = __VLS_asFunctionalComponent(__VLS_373, new __VLS_373({
        span: (9),
    }));
    const __VLS_375 = __VLS_374({
        span: (9),
    }, ...__VLS_functionalComponentArgsRest(__VLS_374));
    const { default: __VLS_378 } = __VLS_376.slots;
    let __VLS_379;
    /** @ts-ignore @type {typeof ___VLS_components.aList | typeof ___VLS_components.AList} */
    aList;
    // @ts-ignore
    const __VLS_380 = __VLS_asFunctionalComponent(__VLS_379, new __VLS_379({
        bordered: true,
        dataSource: (__VLS_ctx.plan.files),
    }));
    const __VLS_381 = __VLS_380({
        bordered: true,
        dataSource: (__VLS_ctx.plan.files),
    }, ...__VLS_functionalComponentArgsRest(__VLS_380));
    const { default: __VLS_384 } = __VLS_382.slots;
    {
        const { renderItem: __VLS_385 } = __VLS_382.slots;
        const [{ item }] = __VLS_getSlotParameters(__VLS_385);
        let __VLS_386;
        /** @ts-ignore @type {typeof ___VLS_components.aListItem | typeof ___VLS_components.AListItem} */
        aListItem;
        // @ts-ignore
        const __VLS_387 = __VLS_asFunctionalComponent(__VLS_386, new __VLS_386({
            ...{ 'onClick': {} },
            ...{ class: ({ active: item.path === __VLS_ctx.selectedPath }) },
        }));
        const __VLS_388 = __VLS_387({
            ...{ 'onClick': {} },
            ...{ class: ({ active: item.path === __VLS_ctx.selectedPath }) },
        }, ...__VLS_functionalComponentArgsRest(__VLS_387));
        let __VLS_391;
        const __VLS_392 = ({ click: {} },
            { onClick: (...[$event]) => {
                    if (!!(!__VLS_ctx.plan))
                        return;
                    __VLS_ctx.selectedPath = item.path;
                    // @ts-ignore
                    [plan, plan, selectedPath, selectedPath,];
                } });
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        const { default: __VLS_393 } = __VLS_389.slots;
        let __VLS_394;
        /** @ts-ignore @type {typeof ___VLS_components.aTag | typeof ___VLS_components.ATag} */
        aTag;
        // @ts-ignore
        const __VLS_395 = __VLS_asFunctionalComponent(__VLS_394, new __VLS_394({
            color: (item.action === 'Conflict' ? 'red' : item.action === 'Update' ? 'orange' : item.action === 'Create' ? 'blue' : 'default'),
        }));
        const __VLS_396 = __VLS_395({
            color: (item.action === 'Conflict' ? 'red' : item.action === 'Update' ? 'orange' : item.action === 'Create' ? 'blue' : 'default'),
        }, ...__VLS_functionalComponentArgsRest(__VLS_395));
        const { default: __VLS_399 } = __VLS_397.slots;
        (item.action);
        // @ts-ignore
        [];
        var __VLS_397;
        (item.path);
        // @ts-ignore
        [];
        var __VLS_389;
        var __VLS_390;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_382;
    // @ts-ignore
    [];
    var __VLS_376;
    let __VLS_400;
    /** @ts-ignore @type {typeof ___VLS_components.aCol | typeof ___VLS_components.ACol} */
    aCol;
    // @ts-ignore
    const __VLS_401 = __VLS_asFunctionalComponent(__VLS_400, new __VLS_400({
        span: (15),
    }));
    const __VLS_402 = __VLS_401({
        span: (15),
    }, ...__VLS_functionalComponentArgsRest(__VLS_401));
    const { default: __VLS_405 } = __VLS_403.slots;
    let __VLS_406;
    /** @ts-ignore @type {typeof ___VLS_components.aTabs | typeof ___VLS_components.ATabs} */
    aTabs;
    // @ts-ignore
    const __VLS_407 = __VLS_asFunctionalComponent(__VLS_406, new __VLS_406({}));
    const __VLS_408 = __VLS_407({}, ...__VLS_functionalComponentArgsRest(__VLS_407));
    const { default: __VLS_411 } = __VLS_409.slots;
    let __VLS_412;
    /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
    aTabPane;
    // @ts-ignore
    const __VLS_413 = __VLS_asFunctionalComponent(__VLS_412, new __VLS_412({
        key: "preview",
        tab: "代码预览",
    }));
    const __VLS_414 = __VLS_413({
        key: "preview",
        tab: "代码预览",
    }, ...__VLS_functionalComponentArgsRest(__VLS_413));
    const { default: __VLS_417 } = __VLS_415.slots;
    __VLS_asFunctionalElement(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({});
    (__VLS_ctx.selectedFile?.content);
    // @ts-ignore
    [selectedFile,];
    var __VLS_415;
    let __VLS_418;
    /** @ts-ignore @type {typeof ___VLS_components.aTabPane | typeof ___VLS_components.ATabPane} */
    aTabPane;
    // @ts-ignore
    const __VLS_419 = __VLS_asFunctionalComponent(__VLS_418, new __VLS_418({
        key: "diff",
        tab: "当前 / 生成 Diff",
    }));
    const __VLS_420 = __VLS_419({
        key: "diff",
        tab: "当前 / 生成 Diff",
    }, ...__VLS_functionalComponentArgsRest(__VLS_419));
    const { default: __VLS_423 } = __VLS_421.slots;
    let __VLS_424;
    /** @ts-ignore @type {typeof ___VLS_components.aRow | typeof ___VLS_components.ARow} */
    aRow;
    // @ts-ignore
    const __VLS_425 = __VLS_asFunctionalComponent(__VLS_424, new __VLS_424({
        gutter: (12),
    }));
    const __VLS_426 = __VLS_425({
        gutter: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_425));
    const { default: __VLS_429 } = __VLS_427.slots;
    let __VLS_430;
    /** @ts-ignore @type {typeof ___VLS_components.aCol | typeof ___VLS_components.ACol} */
    aCol;
    // @ts-ignore
    const __VLS_431 = __VLS_asFunctionalComponent(__VLS_430, new __VLS_430({
        span: (12),
    }));
    const __VLS_432 = __VLS_431({
        span: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_431));
    const { default: __VLS_435 } = __VLS_433.slots;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({});
    (__VLS_ctx.selectedFile?.currentContent ?? '新文件');
    // @ts-ignore
    [selectedFile,];
    var __VLS_433;
    let __VLS_436;
    /** @ts-ignore @type {typeof ___VLS_components.aCol | typeof ___VLS_components.ACol} */
    aCol;
    // @ts-ignore
    const __VLS_437 = __VLS_asFunctionalComponent(__VLS_436, new __VLS_436({
        span: (12),
    }));
    const __VLS_438 = __VLS_437({
        span: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_437));
    const { default: __VLS_441 } = __VLS_439.slots;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({});
    (__VLS_ctx.selectedFile?.content);
    // @ts-ignore
    [selectedFile,];
    var __VLS_439;
    // @ts-ignore
    [];
    var __VLS_427;
    if (__VLS_ctx.selectedFile?.diff) {
        __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (__VLS_ctx.selectedFile.diff);
    }
    // @ts-ignore
    [selectedFile, selectedFile,];
    var __VLS_421;
    // @ts-ignore
    [];
    var __VLS_409;
    // @ts-ignore
    [];
    var __VLS_403;
    // @ts-ignore
    [];
    var __VLS_370;
}
// @ts-ignore
[];
var __VLS_69;
// @ts-ignore
[];
var __VLS_43;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
