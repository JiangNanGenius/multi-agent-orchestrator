import { useMemo, useState } from 'react';
import { useStore, TEMPLATES, TPL_CATS } from '../store';
import type { Template } from '../store';
import { api } from '../api';
import { pickLocaleText } from '../i18n';

const CAT_LABELS: Record<string, { zh: string; en: string }> = {
  全部: { zh: '全部', en: 'All' },
  日常办公: { zh: '日常办公', en: 'Daily Ops' },
  数据分析: { zh: '数据分析', en: 'Data Analysis' },
  工程开发: { zh: '工程开发', en: 'Engineering' },
  内容创作: { zh: '内容创作', en: 'Content' },
};

const DEPT_LABELS: Record<string, { zh: string; en: string }> = {
  总控中心: { zh: '总控中心', en: 'Control Center' },
  规划中心: { zh: '规划中心', en: 'Plan Center' },
  评审中心: { zh: '评审中心', en: 'Review Center' },
  调度中心: { zh: '调度中心', en: 'Dispatch Center' },
  文案专家: { zh: '文案专家', en: 'Docs Specialist' },
  数据专家: { zh: '数据专家', en: 'Data Specialist' },
  代码专家: { zh: '代码专家', en: 'Code Specialist' },
  合规专家: { zh: '合规专家', en: 'Compliance Specialist' },
  部署专家: { zh: '部署专家', en: 'Deploy Specialist' },
};

const TEMPLATE_I18N: Record<string, {
  nameEn: string;
  descEn: string;
  estEn: string;
  params: Record<string, { labelEn: string; optionsEn?: Record<string, string>; placeholderEn?: string }>;
  commandEn: string;
}> = {
  'tpl-weekly-report': {
    nameEn: 'Weekly Report',
    descEn: 'Generate a structured weekly report from board data and specialist outputs.',
    estEn: '~10 min',
    params: {
      date_range: { labelEn: 'Report Period', placeholderEn: 'This week' },
      focus: { labelEn: 'Focus Areas (comma separated)', placeholderEn: 'project progress,next week plan' },
      format: { labelEn: 'Output Format', optionsEn: { Markdown: 'Markdown', 飞书文档: 'Feishu Doc' } },
    },
    commandEn: 'Generate a weekly report for {date_range}, focusing on {focus}, and output it in {format} format',
  },
  'tpl-code-review': {
    nameEn: 'Code Review',
    descEn: 'Review a target repository or file set and produce issue lists with improvement suggestions.',
    estEn: '~20 min',
    params: {
      repo: { labelEn: 'Repository / File Path', placeholderEn: 'Repository or file path' },
      scope: {
        labelEn: 'Review Scope',
        optionsEn: { 全量: 'Full', '增量(最近commit)': 'Incremental (latest commit)', 指定文件: 'Specific files' },
      },
      focus: { labelEn: 'Focus Areas (optional)', placeholderEn: 'security,error handling,performance' },
    },
    commandEn: 'Review {repo}. Scope: {scope}. Focus on: {focus}',
  },
  'tpl-api-design': {
    nameEn: 'API Design & Delivery',
    descEn: 'Go from requirements to RESTful API design, implementation, and testing.',
    estEn: '~45 min',
    params: {
      requirement: { labelEn: 'Requirement Description', placeholderEn: 'Describe the API requirement' },
      tech: { labelEn: 'Tech Stack', optionsEn: { 'Python/FastAPI': 'Python/FastAPI', 'Node/Express': 'Node/Express', 'Go/Gin': 'Go/Gin' } },
      auth: { labelEn: 'Authentication', optionsEn: { JWT: 'JWT', 'API Key': 'API Key', 无: 'None' } },
    },
    commandEn: 'Design and implement a RESTful API in {tech}: {requirement}. Authentication: {auth}',
  },
  'tpl-competitor': {
    nameEn: 'Competitor Analysis',
    descEn: 'Collect competitor data, compare signals, and generate a structured report.',
    estEn: '~60 min',
    params: {
      targets: { labelEn: 'Competitor Name / URL (one per line)', placeholderEn: 'One competitor per line' },
      dimensions: { labelEn: 'Analysis Dimensions', placeholderEn: 'product features,pricing,user reviews' },
      format: { labelEn: 'Output Format', optionsEn: { Markdown报告: 'Markdown Report', 表格对比: 'Table Comparison' } },
    },
    commandEn: 'Analyze the following competitors:\n{targets}\n\nDimensions: {dimensions}. Output format: {format}',
  },
  'tpl-data-report': {
    nameEn: 'Data Report',
    descEn: 'Clean, analyze, and visualize a dataset, then deliver an analysis report.',
    estEn: '~30 min',
    params: {
      data_source: { labelEn: 'Data Source / Path', placeholderEn: 'Dataset description or path' },
      questions: { labelEn: 'Analysis Questions (one per line)', placeholderEn: 'One question per line' },
      viz: { labelEn: 'Need Charts?', optionsEn: { 是: 'Yes', 否: 'No' } },
    },
    commandEn: 'Analyze dataset {data_source}. {questions}\nVisualization required: {viz}',
  },
  'tpl-blog': {
    nameEn: 'Blog Article',
    descEn: 'Generate a high-quality blog article from a topic and content requirements.',
    estEn: '~15 min',
    params: {
      topic: { labelEn: 'Topic', placeholderEn: 'Article topic' },
      audience: { labelEn: 'Target Audience', placeholderEn: 'Technical readers' },
      length: { labelEn: 'Preferred Length', optionsEn: { '~1000字': '~1,000 words', '~2000字': '~2,000 words', '~3000字': '~3,000 words' } },
      style: { labelEn: 'Style', optionsEn: { 技术教程: 'Technical Tutorial', 观点评论: 'Opinion', 案例分析: 'Case Study' } },
    },
    commandEn: 'Write a blog article about “{topic}” for {audience}, around {length}, in a {style} style',
  },
  'tpl-deploy': {
    nameEn: 'Deployment Plan',
    descEn: 'Generate a deployment checklist, AI deployment advice, and a CI/CD workflow.',
    estEn: '~25 min',
    params: {
      project: { labelEn: 'Project Name / Description', placeholderEn: 'Project name or short description' },
      env: { labelEn: 'Deployment Environment', optionsEn: { 'AI 部署': 'AI Deployment', K8s: 'K8s', VPS: 'VPS', Serverless: 'Serverless' } },
      ci: { labelEn: 'CI/CD Tool', optionsEn: { 'GitHub Actions': 'GitHub Actions', 'GitLab CI': 'GitLab CI', 无: 'None' } },
    },
    commandEn: 'Generate a {env} deployment plan for project “{project}”, using {ci} for CI/CD',
  },
  'tpl-email': {
    nameEn: 'Email / Notification Copy',
    descEn: 'Draft professional emails or notices for a given scenario and objective.',
    estEn: '~5 min',
    params: {
      scenario: { labelEn: 'Scenario', optionsEn: { 商务邮件: 'Business Email', 产品发布: 'Product Launch', 客户通知: 'Customer Notice', 内部公告: 'Internal Announcement' } },
      purpose: { labelEn: 'Purpose / Content', placeholderEn: 'Describe the goal and message' },
      tone: { labelEn: 'Tone', optionsEn: { 正式: 'Formal', 友好: 'Friendly', 简洁: 'Concise' } },
    },
    commandEn: 'Draft a {scenario} with a {tone} tone. Content: {purpose}',
  },
  'tpl-standup': {
    nameEn: 'Daily Standup Summary',
    descEn: 'Summarize progress and next steps across centers and specialists for standup.',
    estEn: '~5 min',
    params: {
      range: { labelEn: 'Summary Range', optionsEn: { 今天: 'Today', 最近24小时: 'Last 24 Hours', '昨天+今天': 'Yesterday + Today' } },
    },
    commandEn: 'Summarize progress and outstanding items across centers and specialists for {range}, then generate a standup summary',
  },
};

function labelByLocale(locale: 'zh' | 'en', zh: string, en?: string) {
  return locale === 'en' ? en || zh : zh;
}

export default function TemplatePanel() {
  const locale = useStore((s) => s.locale);
  const tplCatFilter = useStore((s) => s.tplCatFilter);
  const setTplCatFilter = useStore((s) => s.setTplCatFilter);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

  const [formTpl, setFormTpl] = useState<Template | null>(null);
  const [formVals, setFormVals] = useState<Record<string, string>>({});
  const [previewCmd, setPreviewCmd] = useState('');

  const tpls = useMemo(() => {
    if (tplCatFilter !== '全部') return TEMPLATES.filter((t) => t.cat === tplCatFilter);
    return TEMPLATES;
  }, [tplCatFilter]);

  const getTplMeta = (tpl: Template) => TEMPLATE_I18N[tpl.id];
  const getTplName = (tpl: Template) => labelByLocale(locale, tpl.name, getTplMeta(tpl)?.nameEn);
  const getTplDesc = (tpl: Template) => labelByLocale(locale, tpl.desc, getTplMeta(tpl)?.descEn);
  const getTplEst = (tpl: Template) => labelByLocale(locale, tpl.est, getTplMeta(tpl)?.estEn);
  const getDeptLabel = (dept: string) => labelByLocale(locale, dept, DEPT_LABELS[dept]?.en);
  const getCatLabel = (cat: string) => labelByLocale(locale, CAT_LABELS[cat]?.zh || cat, CAT_LABELS[cat]?.en);

  const getParamLabel = (tpl: Template, key: string, zh: string) => labelByLocale(locale, zh, getTplMeta(tpl)?.params[key]?.labelEn);
  const getParamPlaceholder = (tpl: Template, key: string, zh: string) => labelByLocale(locale, zh, getTplMeta(tpl)?.params[key]?.placeholderEn);
  const getOptionLabel = (tpl: Template, key: string, option: string) => labelByLocale(locale, option, getTplMeta(tpl)?.params[key]?.optionsEn?.[option]);

  const buildCmd = (tpl: Template) => {
    let cmd = locale === 'en' ? getTplMeta(tpl)?.commandEn || tpl.command : tpl.command;
    for (const p of tpl.params) {
      const current = formVals[p.key] || p.default || '';
      const rendered = locale === 'en' ? getOptionLabel(tpl, p.key, current) : current;
      cmd = cmd.replace(new RegExp('\\{' + p.key + '\\}', 'g'), rendered || current);
    }
    return cmd;
  };

  const openForm = (tpl: Template) => {
    const vals: Record<string, string> = {};
    tpl.params.forEach((p) => {
      vals[p.key] = p.default || '';
    });
    setFormVals(vals);
    setFormTpl(tpl);
    setPreviewCmd('');
  };

  const preview = () => {
    if (!formTpl) return;
    setPreviewCmd(buildCmd(formTpl));
  };

  const execute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTpl) return;
    const cmd = buildCmd(formTpl);
    if (!cmd.trim()) {
      toast(pickLocaleText(locale, '请填写必填参数', 'Please fill in the required parameters'), 'err');
      return;
    }

    try {
      const st = await api.agentsStatus();
      if (st.ok && st.gateway && !st.gateway.alive) {
        toast(pickLocaleText(locale, '⚠️ 调度网关未启动，任务暂时无法自动派发', '⚠️ Dispatch gateway is offline, so automatic routing is temporarily unavailable'), 'err');
        if (!window.confirm(pickLocaleText(locale, '调度网关未启动，仍要继续提交到总控中心吗？', 'The dispatch gateway is offline. Do you still want to submit this task to the Control Center?'))) return;
      }
    } catch {
      /* ignore */
    }

    const confirmText = locale === 'en'
      ? `Submit this task to the Control Center?\n\n${cmd.substring(0, 200)}${cmd.length > 200 ? '…' : ''}`
      : `确认将任务提交到总控中心吗？\n\n${cmd.substring(0, 200)}${cmd.length > 200 ? '…' : ''}`;
    if (!window.confirm(confirmText)) return;

    try {
      const params: Record<string, string> = {};
      for (const p of formTpl.params) {
        params[p.key] = formVals[p.key] || p.default || '';
      }
      const r = await api.createTask({
        title: cmd.substring(0, 120),
        org: locale === 'en' ? 'Control Center' : '总控中心',
        targetDept: formTpl.depts[0] || '',
        priority: 'normal',
        templateId: formTpl.id,
        params,
      });
      if (r.ok) {
        toast(locale === 'en' ? `📌 ${r.taskId} submitted to the Control Center` : `📌 ${r.taskId} 已提交到总控中心`, 'ok');
        setFormTpl(null);
        loadAll();
      } else {
        toast(r.error || pickLocaleText(locale, '任务提交失败', 'Task submission failed'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '⚠️ 服务器连接失败', '⚠️ Server connection failed'), 'err');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TPL_CATS.map((c) => (
          <span
            key={c.name}
            className={`tpl-cat${tplCatFilter === c.name ? ' active' : ''}`}
            onClick={() => setTplCatFilter(c.name)}
          >
            {c.icon} {getCatLabel(c.name)}
          </span>
        ))}
      </div>

      <div className="tpl-grid">
        {tpls.map((t) => (
          <div className="tpl-card" key={t.id}>
            <div className="tpl-top">
              <span className="tpl-icon">{t.icon}</span>
              <span className="tpl-name">{getTplName(t)}</span>
            </div>
            <div className="tpl-desc">{getTplDesc(t)}</div>
            <div className="tpl-footer">
              {t.depts.map((d) => (
                <span className="tpl-dept" key={d}>{getDeptLabel(d)}</span>
              ))}
              <span className="tpl-est">
                {getTplEst(t)} · {t.cost}
              </span>
              <button className="tpl-go" onClick={() => openForm(t)}>
                {pickLocaleText(locale, '提交任务', 'Submit Task')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {formTpl && (
        <div className="modal-bg open" onClick={() => setFormTpl(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setFormTpl(null)}>✕</button>
            <div className="modal-body">
              <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>
                {pickLocaleText(locale, '任务模板中心', 'Task Template Center')}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
                {formTpl.icon} {getTplName(formTpl)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>{getTplDesc(formTpl)}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
                {formTpl.depts.map((d) => (
                  <span className="tpl-dept" key={d}>{getDeptLabel(d)}</span>
                ))}
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                  {getTplEst(formTpl)} · {formTpl.cost}
                </span>
              </div>

              <form className="tpl-form" onSubmit={execute}>
                {formTpl.params.map((p) => (
                  <div className="tpl-field" key={p.key}>
                    <label className="tpl-label">
                      {getParamLabel(formTpl, p.key, p.label)}
                      {p.required && <span style={{ color: '#ff5270' }}> *</span>}
                    </label>
                    {p.type === 'textarea' ? (
                      <textarea
                        className="tpl-input"
                        style={{ minHeight: 80, resize: 'vertical' }}
                        required={p.required}
                        placeholder={getParamPlaceholder(formTpl, p.key, p.label)}
                        value={formVals[p.key] || ''}
                        onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                      />
                    ) : p.type === 'select' ? (
                      <select
                        className="tpl-input"
                        value={formVals[p.key] || p.default || ''}
                        onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                      >
                        {(p.options || []).map((o) => (
                          <option key={o} value={o}>{getOptionLabel(formTpl, p.key, o)}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="tpl-input"
                        type="text"
                        required={p.required}
                        placeholder={getParamPlaceholder(formTpl, p.key, p.label)}
                        value={formVals[p.key] || ''}
                        onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}

                {previewCmd && (
                  <div
                    style={{
                      background: 'var(--panel2)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 14,
                      fontSize: 12,
                      color: 'var(--muted)',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                      {pickLocaleText(locale, '📌 即将提交到总控中心的任务内容：', '📌 Task content to be submitted to the Control Center:')}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{previewCmd}</div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-g" onClick={preview} style={{ padding: '8px 16px', fontSize: 12 }}>
                    {pickLocaleText(locale, '👁 预览提交内容', '👁 Preview Submission')}
                  </button>
                  <button type="submit" className="tpl-go" style={{ padding: '8px 20px', fontSize: 13 }}>
                    {pickLocaleText(locale, '📌 提交到总控中心', '📌 Submit to Control Center')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
