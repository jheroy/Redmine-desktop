import { useState, useEffect, useCallback, useMemo, startTransition } from 'react';
import { RedmineService } from '../services/RedmineService';
import { Project, Issue, Version, User, IssueStatus, IssuePriority } from '../models/redmine';
import { getAssignedWatchers, getAssignedWatchersField, createAssignedWatchersUpdate } from '../utils/assignedWatchers';

export function useAppViewModel() {
    const [redmineURL, setRedmineURL] = useState(localStorage.getItem('redmineURL') || '');
    const [redmineAPIKey, setRedmineAPIKey] = useState(localStorage.getItem('redmineAPIKey') || '');
    const [refreshInterval, setRefreshInterval] = useState(parseInt(localStorage.getItem('refreshInterval') || '300', 10));
    const [enableTransparency, setEnableTransparency] = useState(localStorage.getItem('enableTransparency') === 'true');
    const [appTheme, setAppTheme] = useState(localStorage.getItem('appTheme') || 'dark');
    const [showBadge, setShowBadge] = useState(localStorage.getItem('showBadge') === 'true');

    // Explicitly track if the user has successfully configured and saved
    const [isConfigured, setIsConfigured] = useState(!!(redmineURL && redmineAPIKey));

    const [projects, setProjects] = useState<Project[]>([]);
    // Load cached issues from localStorage on startup
    const [allIssues, setAllIssues] = useState<Issue[]>(() => {
        try {
            const cached = localStorage.getItem('cachedIssues');
            return cached ? JSON.parse(cached) : [];
        } catch {
            return [];
        }
    });
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [issueStatuses, setIssueStatuses] = useState<IssueStatus[]>([]);
    const [issuePriorities, setIssuePriorities] = useState<IssuePriority[]>([]);
    const [projectVersionsMap, setProjectVersionsMap] = useState<Record<number, Version[]>>({});
    const [projectMembersMap, setProjectMembersMap] = useState<Record<number, { id: number; name: string; groups: string[] }[]>>({});
    const [pinnedVersionIds, setPinnedVersionIds] = useState<Set<number>>(() => {
        const saved = localStorage.getItem('pinnedVersionIds');
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });
    // Track which versions are "active" (should be loaded and auto-refreshed)
    // Default: top 3 versions by name (descending) + user-added versions
    const [activeVersionIds, setActiveVersionIds] = useState<Set<number>>(() => {
        try {
            const cached = localStorage.getItem('cachedActiveVersionIds');
            return cached ? new Set(JSON.parse(cached)) : new Set();
        } catch {
            return new Set();
        }
    });
    // Track if we've initialized active versions for each project
    const [initializedProjects, setInitializedProjects] = useState<Set<number>>(() => {
        try {
            const cached = localStorage.getItem('cachedInitializedProjects');
            return cached ? new Set(JSON.parse(cached)) : new Set();
        } catch {
            return new Set();
        }
    });

    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(() => {
        const saved = localStorage.getItem('lastSelectedProjectId');
        return saved ? parseInt(saved, 10) : -1;
    });

    const [selectedVersionId, setSelectedVersionId] = useState<number | null>(() => {
        const saved = localStorage.getItem('lastSelectedVersionId');
        return saved ? parseInt(saved, 10) : null;
    });

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAssigneeId, setSelectedAssigneeId] = useState<number | null>(() => {
        const saved = localStorage.getItem('lastSelectedAssigneeId');
        return saved ? parseInt(saved, 10) : null;
    });
    const [groupByMode, setGroupByMode] = useState<'status' | 'assignee'>(() => {
        const saved = localStorage.getItem('groupByMode');
        return saved === 'assignee' ? 'assignee' : 'status';
    });
    // 协助者过滤
    const [selectedAssignedWatcherIds, setSelectedAssignedWatcherIds] = useState<Set<number>>(() => {
        const saved = localStorage.getItem('selectedAssignedWatcherIds');
        return saved ? new Set(JSON.parse(saved)) : new Set();
    });
    const [selectedStatusId, setSelectedStatusId] = useState<number | null>(null);
    const [followedIssueIds, setFollowedIssueIds] = useState<Set<number>>(() => {
        try {
            const cached = localStorage.getItem('cachedFollowedIssueIds');
            return cached ? new Set(JSON.parse(cached)) : new Set();
        } catch {
            return new Set();
        }
    });
    const [hideVerifiedInFollowed, setHideVerifiedInFollowed] = useState<boolean>(() => {
        const saved = localStorage.getItem('hideVerifiedInFollowed');
        return saved === 'true';
    });
    const [hideVerifiedInAssigned, setHideVerifiedInAssigned] = useState<boolean>(() => {
        const saved = localStorage.getItem('hideVerifiedInAssigned');
        return saved === 'true';
    });

    const [isLoading, setIsLoading] = useState(false);
    const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const service = useMemo(() => {
        if (redmineURL && redmineAPIKey) {
            return new RedmineService(redmineURL, redmineAPIKey);
        }
        return null;
    }, [redmineURL, redmineAPIKey]);

    const loadInitialData = useCallback(async () => {
        if (!service) return;
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const [user, statuses, priorities, projectsData] = await Promise.all([
                service.fetchCurrentUser(),
                service.fetchIssueStatuses(),
                service.fetchIssuePriorities(),
                service.fetchProjects()
            ]);
            setCurrentUser(user);
            setIssueStatuses(statuses);
            setIssuePriorities(priorities);
            setProjects(projectsData);

            // Fetch versions and members for all projects
            await Promise.allSettled(projectsData.map(async p => {
                try {
                    const [versions, members] = await Promise.all([
                        service.fetchVersions(p.id),
                        service.fetchAssignableUsers(p.id)
                    ]);

                    const sortedVersions = versions.sort((a, b) => {
                        const aPinned = pinnedVersionIds.has(a.id);
                        const bPinned = pinnedVersionIds.has(b.id);
                        if (aPinned !== bPinned) return aPinned ? -1 : 1;
                        const aIsDigit = /^\d/.test(a.name);
                        const bIsDigit = /^\d/.test(b.name);
                        if (aIsDigit !== bIsDigit) return aIsDigit ? -1 : 1;
                        return b.name.localeCompare(a.name, undefined, { numeric: true });
                    });

                    setProjectVersionsMap(prev => ({ ...prev, [p.id]: sortedVersions }));
                    setProjectMembersMap(prev => ({ ...prev, [p.id]: members }));

                    // Functional update to avoid dependency on initializedProjects/activeVersionIds
                    setInitializedProjects(prevInitialized => {
                        if (prevInitialized.has(p.id)) return prevInitialized;

                        const newInitialized = new Set(prevInitialized);
                        newInitialized.add(p.id);

                        setActiveVersionIds(prevActive => {
                            const newActive = new Set(prevActive);
                            const top3Versions = sortedVersions.slice(0, 3);
                            top3Versions.forEach(v => newActive.add(v.id));
                            return newActive;
                        });

                        return newInitialized;
                    });
                } catch (e) {
                    console.error(`Failed to fetch details for project ${p.id}`, e);
                }
            }));
        } catch (error: any) {
            setErrorMessage(`Failed to connect: ${error.message}`);
            setIsConfigured(false);
            setIsLoading(false);
            return;
        }
        setIsLoading(false);
        setIsConfigured(true);
    }, [service, pinnedVersionIds]);

    const refreshIssues = useCallback(async () => {
        if (!service) return;
        setIsBackgroundRefreshing(true);
        try {
            // Fetch issues for all active versions only
            const activeVersionArray = Array.from(activeVersionIds);
            console.log(`[refreshIssues] Refreshing ${activeVersionArray.length} active versions`);

            let allFetchedIssues: Issue[] = [];

            // Fetch issues for each active version
            for (const versionId of activeVersionArray) {
                let offset = 0;
                const limit = 100;
                while (true) {
                    const { issues, total_count } = await service.fetchIssues({
                        fixed_version_id: versionId,
                        status_id: '*',
                        limit,
                        offset
                    });
                    allFetchedIssues = [...allFetchedIssues, ...issues];

                    if (allFetchedIssues.length >= total_count || issues.length < limit) {
                        break;
                    }
                    offset += limit;
                }
            }

            console.log(`[refreshIssues] Fetched ${allFetchedIssues.length} issues from ${activeVersionArray.length} active versions`);

            // 更新issues列表 - 合并活跃版本的issues，保留旧issue的详情字段（attachments, journals等）
            setAllIssues(prev => {
                const refreshedVersionIds = new Set(activeVersionArray);
                const fetchedIssueMap = new Map(allFetchedIssues.map(i => [i.id, i]));

                // 1. 保留那些不属于刚刚刷新的版本的 issue
                const preservedIssues = prev.filter(i =>
                    !i.fixed_version?.id || !refreshedVersionIds.has(i.fixed_version.id)
                );

                // 2. 对于属于已刷新版本的 issue，只有在 fetchedIssueMap 中存在的才保留（即合并更新），不存在的说明已删除或移出版本
                // 但要注意：我们不能简单 filter，因为 preservedIssues 已经移除了所有活跃版本的 issue。
                // 我们应该从 prev 中找出活跃版本的 issue，如果它们在 fetchedIssueMap 中，则进行合并更新。
                const existingActiveIssues = prev.filter(i =>
                    i.fixed_version?.id && refreshedVersionIds.has(i.fixed_version.id)
                );

                const mergedActiveIssues = existingActiveIssues
                    .filter(oldIssue => fetchedIssueMap.has(oldIssue.id))
                    .map(oldIssue => {
                        const newIssue = fetchedIssueMap.get(oldIssue.id)!;
                        // 智能合并：保留附件、日志、关注者等可能只有详情接口才有的字段
                        return {
                            ...newIssue,
                            attachments: newIssue.attachments || oldIssue.attachments,
                            journals: newIssue.journals || oldIssue.journals,
                            watchers: newIssue.watchers || oldIssue.watchers,
                            custom_fields: newIssue.custom_fields || oldIssue.custom_fields
                        };
                    });

                // 3. 找出全新的 issue（在 fetchedIssueMap 中但不在 existingActiveIssues 中）
                const activeIssueIds = new Set(existingActiveIssues.map(i => i.id));
                const brandNewIssues = allFetchedIssues.filter(i => !activeIssueIds.has(i.id));

                const newIssuesList = [...preservedIssues, ...mergedActiveIssues, ...brandNewIssues];

                console.log(`[refreshIssues] 更新后 issues 总数: ${newIssuesList.length} (原: ${prev.length})`);

                // 保存到localStorage缓存
                try {
                    localStorage.setItem('cachedIssues', JSON.stringify(newIssuesList));
                } catch (e) {
                    console.warn('Failed to cache issues:', e);
                }
                return newIssuesList;
            });

            // Fetch followed issues using watcher_id filter (much faster than individual requests)
            // Use cached currentUser instead of fetching again
            if (currentUser) {
                let followedIds = new Set<number>();
                let followedIssuesList: Issue[] = [];
                let offset = 0;
                const limit = 100;
                while (true) {
                    const { issues, total_count } = await service.fetchIssues({
                        watcher_id: currentUser.id,
                        status_id: '*',
                        limit,
                        offset
                    });
                    issues.forEach(i => {
                        followedIds.add(i.id);
                        followedIssuesList.push(i);
                    });
                    if (followedIds.size >= total_count || issues.length < limit) break;
                    offset += limit;
                }
                setFollowedIssueIds(followedIds);
                // Save followed issue IDs to cache
                try {
                    localStorage.setItem('cachedFollowedIssueIds', JSON.stringify(Array.from(followedIds)));
                } catch (e) {
                    console.warn('Failed to cache followed IDs:', e);
                }
                // Merge followed issues into allIssues (some might not be in active versions)
                setAllIssues(prev => {
                    const issueMap = new Map(prev.map(i => [i.id, i]));
                    let changed = false;
                    followedIssuesList.forEach(fi => {
                        const existing = issueMap.get(fi.id);
                        if (!existing) {
                            issueMap.set(fi.id, fi);
                            changed = true;
                        } else {
                            // Smart merge to keep details if any
                            issueMap.set(fi.id, {
                                ...fi,
                                attachments: fi.attachments || existing.attachments,
                                journals: fi.journals || existing.journals,
                                watchers: fi.watchers || existing.watchers,
                                custom_fields: fi.custom_fields || existing.custom_fields
                            });
                            changed = true;
                        }
                    });
                    if (changed) {
                        const newIssues = Array.from(issueMap.values());
                        try {
                            localStorage.setItem('cachedIssues', JSON.stringify(newIssues));
                        } catch (e) {
                            console.warn('Failed to cache issues:', e);
                        }
                        return newIssues;
                    }
                    return prev;
                });
            }
            setErrorMessage(null);
        } catch (e: any) {
            setErrorMessage(`Refresh failed: ${e.message}`);
        } finally {
            setIsBackgroundRefreshing(false);
        }
    }, [service, currentUser, activeVersionIds]); // Badge updates handled by reactive useEffect

    // Fetch issues for a specific version (for Others section)
    const fetchVersionIssues = useCallback(async (versionId: number) => {
        if (!service) return;
        try {
            setIsLoading(true);
            let allFetchedIssues: Issue[] = [];
            let offset = 0;
            const limit = 100;

            while (true) {
                const { issues, total_count } = await service.fetchIssues({
                    fixed_version_id: versionId,
                    status_id: '*',
                    include: 'journals,attachments,watchers',
                    limit,
                    offset
                });
                allFetchedIssues = [...allFetchedIssues, ...issues];

                if (allFetchedIssues.length >= total_count || issues.length < limit || allFetchedIssues.length >= 500) {
                    break;
                }
                offset += limit;
            }

            console.log(`Fetched ${allFetchedIssues.length} issues for version ${versionId}`);
            // Merge with existing issues, avoiding duplicates and preserving details
            setAllIssues(prev => {
                const issueMap = new Map(prev.map(i => [i.id, i]));
                allFetchedIssues.forEach(i => {
                    const existing = issueMap.get(i.id);
                    if (existing) {
                        issueMap.set(i.id, {
                            ...i,
                            attachments: i.attachments || existing.attachments,
                            journals: i.journals || existing.journals,
                            watchers: i.watchers || existing.watchers,
                            custom_fields: i.custom_fields || existing.custom_fields
                        });
                    } else {
                        issueMap.set(i.id, i);
                    }
                });
                return Array.from(issueMap.values());
            });
            setErrorMessage(null);
        } catch (e: any) {
            setErrorMessage(`Failed to fetch version issues: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [service]);

    const sortVersions = useCallback((versions: Version[], pinnedIds: Set<number>) => {
        return [...versions].sort((a, b) => {
            // 1. Pinned versions first
            const aPinned = pinnedIds.has(a.id);
            const bPinned = pinnedIds.has(b.id);
            if (aPinned !== bPinned) return aPinned ? -1 : 1;

            // 2. Numbers-starting versions next
            const aIsDigit = /^\d/.test(a.name);
            const bIsDigit = /^\d/.test(b.name);
            if (aIsDigit !== bIsDigit) return aIsDigit ? -1 : 1;

            // 3. Descending numeric sort
            return b.name.localeCompare(a.name, undefined, { numeric: true });
        });
    }, []);

    const fetchProjectDetails = useCallback(async (projectId: number) => {
        if (!service) return;
        try {
            // Fetch versions and members independently
            service.fetchVersions(projectId).then(versions => {
                setProjectVersionsMap(prev => ({
                    ...prev,
                    [projectId]: sortVersions(versions, pinnedVersionIds)
                }));
            }).catch(e => console.error(`Failed to fetch versions for project ${projectId}`, e));

            service.fetchAssignableUsers(projectId).then(members => {
                setProjectMembersMap(prev => ({ ...prev, [projectId]: members }));
            }).catch(e => console.error(`Failed to fetch members for project ${projectId}`, e));

        } catch (e: any) {
            console.error('Failed to initiate project details fetch', e);
        }
    }, [service, pinnedVersionIds, sortVersions]);

    const versionIssueCounts = useMemo(() => {
        const counts: Record<number, number> = {};
        allIssues.forEach(i => {
            if (i.fixed_version?.id) {
                counts[i.fixed_version.id] = (counts[i.fixed_version.id] || 0) + 1;
            }
        });
        return counts;
    }, [allIssues]);

    // Status-based counts per version: { versionId: { dev: number; done: number; verified: number } }
    // Filtered by selected assignee
    const versionStatusCounts = useMemo(() => {
        const counts: Record<number, { dev: number; done: number; verified: number }> = {};
        allIssues.forEach(i => {
            // Filter by assignee if one is selected
            if (selectedAssigneeId !== null && i.assigned_to?.id !== selectedAssigneeId) {
                return;
            }
            if (i.fixed_version?.id) {
                const vid = i.fixed_version.id;
                if (!counts[vid]) counts[vid] = { dev: 0, done: 0, verified: 0 };
                const statusName = i.status.name;
                if (statusName.includes('验证完成')) {
                    counts[vid].verified++;
                } else if (statusName.includes('开发完成')) {
                    counts[vid].done++;
                } else {
                    counts[vid].dev++;
                }
            }
        });
        return counts;
    }, [allIssues, selectedAssigneeId]);

    const followedStatusCounts = useMemo(() => {
        const sc = { dev: 0, done: 0, verified: 0 };
        allIssues.forEach(i => {
            if (followedIssueIds.has(i.id)) {
                const statusName = i.status.name;
                if (statusName.includes('验证完成')) {
                    sc.verified++;
                } else if (statusName.includes('开发完成')) {
                    sc.done++;
                } else {
                    sc.dev++;
                }
            }
        });
        return sc;
    }, [allIssues, followedIssueIds]);

    const assignedStatusCounts = useMemo(() => {
        const sc = { dev: 0, done: 0, verified: 0 };
        if (!currentUser) return sc;
        allIssues.forEach(i => {
            if (i.assigned_to?.id === currentUser.id) {
                const statusName = i.status.name;
                if (statusName.includes('验证完成')) {
                    sc.verified++;
                } else if (statusName.includes('开发完成')) {
                    sc.done++;
                } else {
                    sc.dev++;
                }
            }
        });
        return sc;
    }, [allIssues, currentUser]);

    useEffect(() => {
        if (service && isConfigured) {
            loadInitialData();
        }
    }, [service, isConfigured, loadInitialData]);

    useEffect(() => {
        if (isConfigured && selectedProjectId && selectedProjectId !== -1) {
            fetchProjectDetails(selectedProjectId);
        }
    }, [selectedProjectId, fetchProjectDetails, isConfigured]);

    useEffect(() => {
        if (isConfigured) {
            refreshIssues();
        }
    }, [isConfigured, selectedAssigneeId, refreshIssues]);

    useEffect(() => {
        if (isConfigured) {
            if (selectedProjectId !== null) localStorage.setItem('lastSelectedProjectId', selectedProjectId.toString());
            else localStorage.removeItem('lastSelectedProjectId');
            if (selectedVersionId !== null) localStorage.setItem('lastSelectedVersionId', selectedVersionId.toString());
            else localStorage.removeItem('lastSelectedVersionId');
            if (selectedAssigneeId !== null) localStorage.setItem('lastSelectedAssigneeId', selectedAssigneeId.toString());
            else localStorage.removeItem('lastSelectedAssigneeId');
        }
        localStorage.setItem('enableTransparency', enableTransparency.toString());
        localStorage.setItem('appTheme', appTheme);
        localStorage.setItem('refreshInterval', refreshInterval.toString());
        localStorage.setItem('showBadge', showBadge.toString());
        localStorage.setItem('pinnedVersionIds', JSON.stringify(Array.from(pinnedVersionIds)));
        localStorage.setItem('selectedAssignedWatcherIds', JSON.stringify(Array.from(selectedAssignedWatcherIds)));
        localStorage.setItem('hideVerifiedInFollowed', hideVerifiedInFollowed.toString());
        localStorage.setItem('hideVerifiedInAssigned', hideVerifiedInAssigned.toString());
        localStorage.setItem('groupByMode', groupByMode);
        localStorage.setItem('cachedActiveVersionIds', JSON.stringify(Array.from(activeVersionIds)));
        localStorage.setItem('cachedInitializedProjects', JSON.stringify(Array.from(initializedProjects)));
    }, [selectedProjectId, selectedVersionId, selectedAssigneeId, selectedAssignedWatcherIds, enableTransparency, appTheme, refreshInterval, showBadge, isConfigured, pinnedVersionIds, hideVerifiedInFollowed, hideVerifiedInAssigned, groupByMode, activeVersionIds, initializedProjects]);

    // Periodical Background Refresh
    useEffect(() => {
        if (!isConfigured || refreshInterval <= 0) return;

        const intervalId = setInterval(() => {
            console.log('Background refreshing issues...');
            refreshIssues();
        }, refreshInterval * 1000);

        return () => clearInterval(intervalId);
    }, [isConfigured, refreshInterval, refreshIssues]);

    // Reactive badge update - updates whenever allIssues, showBadge, or currentUser changes
    useEffect(() => {
        if (!currentUser) return;

        if (showBadge) {
            const myUnfinishedCount = allIssues.filter(i =>
                i.assigned_to?.id === currentUser.id &&
                !i.status.name.includes('完成') &&
                !i.status.name.includes('关闭')
            ).length;
            console.log('Badge update (reactive):', myUnfinishedCount);
            (window as any).ipcRenderer?.send('update-badge', myUnfinishedCount);
        } else {
            (window as any).ipcRenderer?.send('update-badge', 0);
        }
    }, [allIssues, showBadge, currentUser]);

    const saveSettings = async (url: string, key: string) => {
        localStorage.setItem('redmineURL', url);
        localStorage.setItem('redmineAPIKey', key);
        setRedmineURL(url);
        setRedmineAPIKey(key);
        setIsConfigured(true);
        // loadInitialData will be triggered by useEffect
    };

    const fetchIssueDetail = useCallback(async (id: number) => {
        if (!service) return;
        try {
            const detail = await service.fetchIssueDetail(id);
            setAllIssues(prev => {
                const oldIssue = prev.find(i => i.id === id);
                // Only update if data actually changed OR if it's the first time we get full details (journals/attachments/watchers)
                if (oldIssue && oldIssue.updated_on === detail.updated_on &&
                    (oldIssue.journals?.length === detail.journals?.length) &&
                    (oldIssue.watchers?.length === detail.watchers?.length)) {
                    return prev;
                }
                return prev.map(i => i.id === id ? detail : i);
            });
        } catch (e: any) {
            console.error(`Failed to fetch detail for issue ${id}`, e);
        }
    }, [service]);

    const addWatcher = async (issueId: number, userId: number) => {
        if (!service) return;
        try {
            await service.addWatcher(issueId, userId);
            // Update cache if current user was added
            if (currentUser && userId === currentUser.id) {
                setFollowedIssueIds(prev => new Set(prev).add(issueId));
            }
            await fetchIssueDetail(issueId);
        } catch (e: any) {
            setErrorMessage(`Failed to add watcher: ${e.message}`);
        }
    };

    const removeWatcher = async (issueId: number, userId: number) => {
        if (!service) return;
        try {
            await service.removeWatcher(issueId, userId);
            // Update cache if current user was removed
            if (currentUser && userId === currentUser.id) {
                setFollowedIssueIds(prev => {
                    const next = new Set(prev);
                    next.delete(issueId);
                    return next;
                });
            }
            await fetchIssueDetail(issueId);
        } catch (e: any) {
            setErrorMessage(`Failed to remove watcher: ${e.message}`);
        }
    };

    // 协助者管理（通过自定义字段）
    const addAssignedWatcher = async (issue: Issue, userId: number) => {
        if (!service) return;
        try {
            // 获取当前协助者
            const currentAssistants = getAssignedWatchers(issue);
            const assistantIds = currentAssistants.map(a => a.id);

            // 如果已存在则不添加
            if (assistantIds.includes(userId)) {
                return;
            }

            // 添加新协助者
            assistantIds.push(userId);

            // 获取自定义字段ID
            const field = getAssignedWatchersField(issue);
            if (!field) {
                setErrorMessage('协助者自定义字段未找到');
                return;
            }

            // 更新 Issue
            const customFieldsUpdate = createAssignedWatchersUpdate(field.id, assistantIds);
            await service.updateIssue(issue.id, { custom_fields: customFieldsUpdate });
            await fetchIssueDetail(issue.id);
        } catch (e: any) {
            setErrorMessage(`Failed to add assigned watcher: ${e.message}`);
        }
    };

    const removeAssignedWatcher = async (issue: Issue, userId: number) => {
        if (!service) return;
        try {
            // 获取当前协助者
            const currentAssistants = getAssignedWatchers(issue);
            const assistantIds = currentAssistants.map(a => a.id).filter(id => id !== userId);

            // 获取自定义字段ID
            const field = getAssignedWatchersField(issue);
            if (!field) {
                setErrorMessage('协助者自定义字段未找到');
                return;
            }

            // 更新 Issue
            const customFieldsUpdate = createAssignedWatchersUpdate(field.id, assistantIds);
            await service.updateIssue(issue.id, { custom_fields: customFieldsUpdate });
            await fetchIssueDetail(issue.id);
        } catch (e: any) {
            setErrorMessage(`Failed to remove assigned watcher: ${e.message}`);
        }
    };

    const updateIssue = async (id: number, data: any) => {
        if (!service) return;
        setIsLoading(true);
        try {
            await service.updateIssue(id, data);
            const updated = await service.fetchIssueDetail(id);
            setAllIssues(prev => prev.map(i => i.id === id ? updated : i));
        } catch (e: any) {
            setErrorMessage(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const addNote = async (id: number, note: string) => {
        await updateIssue(id, { notes: note });
    };

    const createIssue = async (subject: string, projectId: number, versionId?: number, assignedToId?: number) => {
        if (!service) return;
        setIsLoading(true);
        try {
            const newIssue = await service.createIssue({
                project_id: projectId,
                subject,
                fixed_version_id: versionId,
                assigned_to_id: assignedToId
            });
            // Directly add the new issue to the list instead of refreshing all issues
            // This provides instant feedback to the user
            setAllIssues(prev => [newIssue, ...prev]);
            // Also update localStorage cache
            try {
                const cached = localStorage.getItem('cachedIssues');
                if (cached) {
                    const cachedIssues = JSON.parse(cached);
                    localStorage.setItem('cachedIssues', JSON.stringify([newIssue, ...cachedIssues]));
                }
            } catch (e) {
                console.warn('Failed to update cache:', e);
            }
        } catch (e: any) {
            setErrorMessage(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const createVersion = async (projectId: number, name: string) => {
        if (!service) return;
        try {
            const newVersion = await service.createVersion(projectId, name);
            // Add to project versions map
            setProjectVersionsMap(prev => {
                const existing = prev[projectId] || [];
                return { ...prev, [projectId]: [newVersion, ...existing] };
            });
            return newVersion;
        } catch (e: any) {
            setErrorMessage(`Failed to create version: ${e.message}`);
        }
    };

    const deleteVersion = async (projectId: number, versionId: number) => {
        if (!service) return;
        try {
            await service.deleteVersion(versionId);
            // Remove from project versions map
            setProjectVersionsMap(prev => {
                const existing = prev[projectId] || [];
                return { ...prev, [projectId]: existing.filter(v => v.id !== versionId) };
            });
        } catch (e: any) {
            setErrorMessage(`Failed to delete version: ${e.message}`);
        }
    };

    const updateVersion = async (projectId: number, versionId: number, data: any) => {
        if (!service) return;
        try {
            await service.updateVersion(versionId, data);
            // Refresh versions for the project
            const versions = await service.fetchVersions(projectId);
            setProjectVersionsMap(prev => ({
                ...prev,
                [projectId]: sortVersions(versions, pinnedVersionIds)
            }));
        } catch (e: any) {
            setErrorMessage(`Failed to update version: ${e.message}`);
        }
    };

    const togglePinVersion = useCallback((projectId: number, versionId: number) => {
        setPinnedVersionIds(prev => {
            const next = new Set(prev);
            if (next.has(versionId)) next.delete(versionId);
            else next.add(versionId);

            // Re-sort current project's versions immediately
            setProjectVersionsMap(currentMap => {
                const versions = currentMap[projectId];
                if (!versions) return currentMap;
                return {
                    ...currentMap,
                    [projectId]: sortVersions(versions, next)
                };
            });

            return next;
        });
    }, [sortVersions]);

    // Toggle a version's active status (move into/out of Others)
    const toggleVersionActive = useCallback(async (versionId: number) => {
        let activating = false;
        setActiveVersionIds(prev => {
            const next = new Set(prev);
            if (next.has(versionId)) {
                next.delete(versionId);
                activating = false;
            } else {
                next.add(versionId);
                activating = true;
            }
            return next;
        });

        if (activating) {
            console.log(`[toggleVersionActive] Version ${versionId} activated, fetching issues...`);
            await fetchVersionIssues(versionId);
        } else {
            console.log(`[toggleVersionActive] Version ${versionId} moved to Others`);
        }
    }, [fetchVersionIssues]);

    const deleteIssue = async (issueId: number) => {
        if (!service) return;
        try {
            await service.deleteIssue(issueId);
            // Remove from allIssues
            setAllIssues(prev => prev.filter(i => i.id !== issueId));
        } catch (e: any) {
            setErrorMessage(`Failed to delete issue: ${e.message}`);
        }
    };

    const uploadAttachment = async (file: File) => {
        if (!service) return null;
        try {
            return await service.uploadFile(file);
        } catch (e: any) {
            setErrorMessage(`Upload failed: ${e.message}`);
            return null;
        }
    };

    const selectProject = (projectId: number | null) => {
        setSelectedProjectId(projectId);
        setSelectedVersionId(null);
    };

    const selectVersion = (projectId: number, versionId: number | null) => {
        setSelectedProjectId(projectId);
        setSelectedVersionId(versionId);
    };

    const filteredIssues = useMemo(() => {
        return allIssues.filter(i => {
            const isMyFollowed = selectedProjectId === -2;
            const isMyAssigned = selectedProjectId === -3;
            const isSpecialView = isMyFollowed || isMyAssigned;

            const matchProject = selectedProjectId === -1 || isSpecialView || i.project?.id === selectedProjectId;
            const matchFollowed = !isMyFollowed || followedIssueIds.has(i.id);
            const matchAssigned = !isMyAssigned || (currentUser && i.assigned_to?.id === currentUser.id);

            const matchVersion = !selectedVersionId || i.fixed_version?.id === selectedVersionId;
            // Skip assignee and assigned watcher filters in special views (My Followed, My Assigned)
            const matchAssignee = isSpecialView || !selectedAssigneeId || i.assigned_to?.id === selectedAssigneeId;
            // 协助者过滤:如果选了协助者,则只显示包含该协助者的问题
            const assignedWatchers = getAssignedWatchers(i);
            const matchAssignedWatchers = isSpecialView || selectedAssignedWatcherIds.size === 0 ||
                assignedWatchers.some(aw => selectedAssignedWatcherIds.has(aw.id));
            const matchStatus = !selectedStatusId || i.status.id === selectedStatusId;
            const matchQuery = !searchQuery ||
                i.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
                i.id.toString().includes(searchQuery);
            // Hide verified issues in special views if toggle is on
            const shouldHideVerified = (isMyFollowed && hideVerifiedInFollowed) || (isMyAssigned && hideVerifiedInAssigned);
            const matchHideVerified = !shouldHideVerified || !i.status.name.includes('验证完成');
            return matchProject && matchFollowed && matchAssigned && matchVersion && matchAssignee && matchAssignedWatchers && matchStatus && matchQuery && matchHideVerified;
        });
    }, [allIssues, selectedProjectId, selectedVersionId, selectedAssigneeId, selectedAssignedWatcherIds, selectedStatusId, searchQuery, followedIssueIds, currentUser, hideVerifiedInFollowed, hideVerifiedInAssigned]);

    const statusSortMap = useMemo(() => {
        return issueStatuses.reduce((acc, s, idx) => ({ ...acc, [s.name]: idx }), {} as Record<string, number>);
    }, [issueStatuses]);

    const followedIssuesCount = useMemo(() => {
        return followedIssueIds.size;
    }, [followedIssueIds]);

    const groupedIssues = useMemo(() => {
        const groups: Record<string, Issue[]> = {};
        const keys: string[] = [];

        if (groupByMode === 'assignee') {
            // Group by assignee
            filteredIssues.forEach(i => {
                const assigneeName = i.assigned_to?.name || '未指派';
                if (!groups[assigneeName]) {
                    groups[assigneeName] = [];
                    keys.push(assigneeName);
                }
                groups[assigneeName].push(i);
            });
            // Sort: '未指派' at end, others alphabetically
            keys.sort((a, b) => {
                if (a === '未指派') return 1;
                if (b === '未指派') return -1;
                return a.localeCompare(b);
            });
        } else {
            // Group by status (default)
            filteredIssues.forEach(i => {
                const statusName = i.status.name;
                if (!groups[statusName]) {
                    groups[statusName] = [];
                    keys.push(statusName);
                }
                groups[statusName].push(i);
            });
            keys.sort((a, b) => (statusSortMap[a] ?? 99) - (statusSortMap[b] ?? 99));
        }

        return { groups, sortedKeys: keys };
    }, [filteredIssues, statusSortMap, groupByMode]);

    const globalMembers = useMemo(() => {
        const memberMap = new Map<number, { id: number; name: string; groups: string[] }>();

        // Helper to add user to map with consistent name formatting
        const addUser = (u: any, groups?: string[]) => {
            if (!u || !u.id) return;
            const existing = memberMap.get(u.id);
            const name = u.name || (u.firstname && u.lastname ? `${u.firstname} ${u.lastname}` : u.firstname || u.lastname || 'Unknown');
            if (existing) {
                // Merge groups
                if (groups) {
                    groups.forEach(g => {
                        if (!existing.groups.includes(g)) existing.groups.push(g);
                    });
                }
            } else {
                memberMap.set(u.id, {
                    id: u.id,
                    name,
                    groups: groups || []
                });
            }
        };

        // Add from project members map (with groups)
        Object.values(projectMembersMap).flat().forEach(m => addUser(m, m.groups));

        // Add from all fetched issues (assignees, authors, and assigned watchers - no group info)
        allIssues.forEach(i => {
            addUser(i.assigned_to);
            addUser(i.author);
            // 从自定义字段中获取协助者
            const assignedWatchers = getAssignedWatchers(i);
            assignedWatchers.forEach(aw => addUser(aw));
        });

        return Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [projectMembersMap, allIssues]);

    return {
        isConfigured,
        saveSettings,
        projects,
        currentUser,
        issueStatuses,
        issuePriorities,
        projectVersionsMap,
        projectMembersMap,
        selectedProjectId,
        selectProject,
        selectedVersionId,
        selectVersion,
        selectedAssigneeId,
        setSelectedAssigneeId,
        selectedAssignedWatcherIds,
        setSelectedAssignedWatcherIds,
        selectedStatusId,
        setSelectedStatusId,
        groupByMode,
        setGroupByMode,
        searchQuery,
        setSearchQuery,
        isLoading,
        isBackgroundRefreshing,
        errorMessage,
        groupedIssues,
        updateIssue,
        addNote,
        addWatcher,         // 关注者
        removeWatcher,      // 关注者
        addAssignedWatcher,     // 协助者
        removeAssignedWatcher,  // 协助者
        createIssue,
        refreshData: refreshIssues,
        redmineURL,
        redmineAPIKey,
        refreshInterval, setRefreshInterval,
        enableTransparency, setEnableTransparency,
        appTheme, setAppTheme,
        showBadge, setShowBadge,
        fetchImageBlob: (url: string) => service?.fetchImageBlob(url),
        versionIssueCounts,
        versionStatusCounts,
        activeVersionIds,
        setActiveVersionIds,
        toggleVersionActive,
        allIssues,
        fetchIssueDetail,
        fetchVersionIssues,
        createVersion,
        updateVersion,
        deleteVersion,
        deleteIssue,
        uploadAttachment,
        globalMembers,
        pinnedVersionIds,
        togglePinVersion,
        followedIssuesCount,
        followedStatusCounts,
        followedIssueIds,
        assignedStatusCounts,
        hideVerifiedInFollowed,
        setHideVerifiedInFollowed,
        hideVerifiedInAssigned,
        setHideVerifiedInAssigned
    };
}
