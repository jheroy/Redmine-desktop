import { Issue, CustomField } from '../models/redmine';

// 协助者自定义字段的名称（请根据您的 Redmine 配置调整）
const ASSIGNED_WATCHERS_FIELD_NAME = '协助者';

/**
 * 从 Issue 的自定义字段中获取协助者列表
 */
export function getAssignedWatchers(issue: Issue): { id: number; name: string }[] {
    if (!issue.custom_fields) return [];

    const field = issue.custom_fields.find(cf => cf.name === ASSIGNED_WATCHERS_FIELD_NAME);
    if (!field || !field.value) {
        return [];
    }

    // 自定义字段的 value 是字符串ID数组
    if (Array.isArray(field.value)) {
        return field.value.map((v: any) => ({
            id: typeof v === 'object' ? parseInt(v.id) : parseInt(v),
            name: '' // 名字需要在UI层从globalMembers查找
        })).filter(u => u.id && !isNaN(u.id));
    }

    return [];
}

/**
 * 从 Issue 的自定义字段中获取协助者的自定义字段对象
 */
export function getAssignedWatchersField(issue: Issue): CustomField | undefined {
    if (!issue.custom_fields) return undefined;
    return issue.custom_fields.find(cf => cf.name === ASSIGNED_WATCHERS_FIELD_NAME);
}

/**
 * 创建用于更新协助者的自定义字段数据
 * @param fieldId 自定义字段ID
 * @param assistantIds 协助者的用户ID数组
 * @returns 用于 updateIssue API 的 custom_fields 数组
 */
export function createAssignedWatchersUpdate(fieldId: number, assistantIds: number[]): any[] {
    return [{
        id: fieldId,
        value: assistantIds
    }];
}
