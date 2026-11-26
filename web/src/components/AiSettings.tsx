import { useEffect, useMemo, useState } from 'react'
import { clearAiConfig, getAiConfig, saveAiConfig, testAiConnection } from '../api'
import type { AiConfigStatus, AiTestResult } from '../api'
import { Icon } from './ui'

interface Preset {
  key: string
  label: string
  provider: string
  baseUrl: string
  model: string
  hint?: string
}

const PRESETS: Preset[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek 官方',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '国内直连，便宜稳定',
  },
  {
    key: 'opencode-go',
    label: 'OpenCode Go',
    provider: 'opencode',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    model: 'deepseek-v4.1-flash',
    hint: 'Go 订阅，OpenAI 兼容网关',
  },
  {
    key: 'opencode-zen',
    label: 'OpenCode Zen',
    provider: 'opencode',
    baseUrl: 'https://opencode.ai/inference/openai/v1',
    model: 'deepseek-v4.1-flash',
    hint: '按量计费，模型更全',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '需要能访问 api.openai.com',
  },
  {
    key: 'dashscope',
    label: '通义千问',
    provider: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  { key: 'custom', label: '自定义（任意 OpenAI 兼容端点）', provider: 'custom', baseUrl: '', model: '' },
]

export function AiSettings({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [status, setStatus] = useState<AiConfigStatus | null>(null)
  const [presetKey, setPresetKey] = useState('deepseek')
  const [provider, setProvider] = useState('deepseek')
  const [baseUrl, setBaseUrl] = useState(PRESETS[0].baseUrl)
  const [model, setModel] = useState(PRESETS[0].model)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'' | 'test' | 'save' | 'clear'>('')
  const [testResult, setTestResult] = useState<AiTestResult | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    getAiConfig().then((data) => {
      setStatus(data)
      if (data.configured && data.source === 'ui') {
        setProvider(data.provider || 'custom')
        setBaseUrl(data.baseUrl || '')
        setModel(data.model || '')
        const matched = PRESETS.find((p) => p.baseUrl === data.baseUrl)
        setPresetKey(matched?.key || 'custom')
      } else if (data.configured && data.source === 'env') {
        setProvider(data.provider || 'custom')
        setBaseUrl(data.baseUrl || '')
        setModel(data.model || '')
        const matched = PRESETS.find((p) => p.baseUrl === data.baseUrl)
        setPresetKey(matched?.key || 'custom')
      }
    })
  }, [])

  const keyPlaceholder = useMemo(() => {
    if (status?.configured && status.keyMasked) return `已保存 ${status.keyMasked}，留空则沿用`
    return 'sk-xxxx 或 oc_sk_xxxx'
  }, [status])

  function applyPreset(key: string) {
    setPresetKey(key)
    const preset = PRESETS.find((p) => p.key === key)
    if (!preset) return
    setProvider(preset.provider)
    if (preset.baseUrl) setBaseUrl(preset.baseUrl)
    if (preset.model) setModel(preset.model)
    setTestResult(null)
    setMessage(null)
  }

  const canSubmit = Boolean(baseUrl.trim() && model.trim() && (apiKey.trim() || status?.configured))

  async function handleTest() {
    setBusy('test')
    setMessage(null)
    setTestResult(null)
    try {
      const result = await testAiConnection({
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      })
      setTestResult(result)
    } catch (error: any) {
      setTestResult({ ok: false, latencyMs: 0, error: error?.message || '测试失败' })
    } finally {
      setBusy('')
    }
  }

  async function handleSave() {
    setBusy('save')
    setMessage(null)
    try {
      const data = await saveAiConfig({
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      })
      setStatus(data)
      setApiKey('')
      setMessage({ kind: 'ok', text: '已保存并立即生效。对已分析过的仓库请点「重新体检」重新生成 AI 建议。' })
      onSaved()
    } catch (error: any) {
      setMessage({ kind: 'error', text: error?.message || '保存失败' })
    } finally {
      setBusy('')
    }
  }

  async function handleClear() {
    if (!window.confirm('删除本机保存的 AI 配置？之后会回退到环境变量或内置规则引擎。')) return
    setBusy('clear')
    setMessage(null)
    try {
      const data = await clearAiConfig()
      setStatus(data)
      setApiKey('')
      setMessage({ kind: 'ok', text: '已删除本机 AI 配置。' })
      onSaved()
    } catch (error: any) {
      setMessage({ kind: 'error', text: error?.message || '删除失败' })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ai-settings" role="dialog" aria-label="AI 设置">
        <div className="modal-head">
          <div>
            <h3>AI 设置</h3>
            <p className="muted small">配置后立即生效，不用改文件、不用重启。Key 只保存在本机。</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="ai-settings-body">
          <div className="ai-status-row">
            <span className={`badge ${status?.configured ? 'badge-ai' : ''}`}>
              <Icon name="spark" size={13} />
              {status?.configured ? `已配置 · ${status.provider}` : '未配置'}
            </span>
            {status?.configured && status.keyMasked && (
              <code className="mono muted small">{status.keyMasked}</code>
            )}
            {status?.configured && status.source === 'env' && (
              <span className="muted small">来自环境变量 / .env</span>
            )}
          </div>

          <label className="field">
            <span>服务商</span>
            <select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            {PRESETS.find((p) => p.key === presetKey)?.hint && (
              <small className="muted">{PRESETS.find((p) => p.key === presetKey)?.hint}</small>
            )}
          </label>

          <label className="field">
            <span>Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
            />
            <small className="muted">OpenAI 兼容端点，填到 /v1 为止，不要带 /chat/completions</small>
          </label>

          <label className="field">
            <span>模型</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-chat"
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyPlaceholder}
              autoComplete="off"
            />
            <small className="muted">
              保存在 <code className="mono">.cache/ai-config.json</code>（已被 git 忽略，不会提交）
            </small>
          </label>

          {testResult && (
            <div className={`ai-test ${testResult.ok ? 'ok' : 'fail'}`}>
              {testResult.ok
                ? `连接正常 · ${testResult.latencyMs}ms${testResult.reply ? ` · 模型回复「${testResult.reply}」` : ''}`
                : `连接失败：${testResult.error}`}
            </div>
          )}

          {message && <div className={`ai-test ${message.kind === 'ok' ? 'ok' : 'fail'}`}>{message.text}</div>}
        </div>

        <div className="modal-foot ai-settings-foot">
          <div className="ai-settings-actions">
            <button type="button" className="btn-ghost" onClick={handleTest} disabled={busy !== '' || !baseUrl.trim() || !model.trim()}>
              {busy === 'test' ? '测试中…' : '测试连接'}
            </button>
            <button type="button" className="btn-ghost primary" onClick={handleSave} disabled={busy !== '' || !canSubmit}>
              {busy === 'save' ? '保存中…' : '保存并启用'}
            </button>
          </div>
          <div className="ai-settings-actions">
            <button type="button" className="btn-ghost danger" onClick={handleClear} disabled={busy !== '' || !status?.configured}>
              {busy === 'clear' ? '删除中…' : '删除本机配置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
