#!/usr/bin/env node
/**
 * AI 配置单测：验证网页端配置的保存 / 优先级 / 打码 / 清除。
 * 不联网，使用临时配置文件。
 *
 *   npm test
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(os.tmpdir(), 'repopulse-ai-config-'))
process.env.REPOPULSE_AI_CONFIG = path.join(root, 'ai-config.json')
// 清掉可能存在的环境变量，保证测试只看网页配置
for (const key of ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'OPENCODE_API_KEY']) {
  delete process.env[key]
}

const { clearAiConfig, publicAiConfig, saveAiConfig } = await import('../server/lib/ai-config.mjs')
const { aiProviderInfo } = await import('../server/lib/ai.mjs')

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}`)
    throw error
  }
}

try {
  console.log('AI 配置')

  check('初始状态为未配置', () => {
    const info = publicAiConfig()
    assert.equal(info.configured, false)
    assert.equal(aiProviderInfo().configured, false)
  })

  check('保存后立即生效，且接口只返回打码 Key', () => {
    saveAiConfig({
      provider: 'opencode',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1/',
      model: 'deepseek-v4.1-flash',
      apiKey: 'oc_sk_test_1234567890abcdef',
    })
    const info = publicAiConfig()
    assert.equal(info.configured, true)
    assert.equal(info.source, 'ui')
    assert.equal(info.baseUrl, 'https://opencode.ai/inference/go/openai/v1') // 末尾斜杠被规范化
    assert.ok(info.keyMasked.includes('****'), 'Key 必须打码')
    assert.ok(!info.keyMasked.includes('1234567890'), '不能返回完整 Key')
    assert.equal(JSON.stringify(info).includes('oc_sk_test_1234567890abcdef'), false)
  })

  check('网页配置优先于环境变量', () => {
    process.env.OPENAI_API_KEY = 'sk-env-should-lose'
    const info = aiProviderInfo()
    assert.equal(info.provider, 'opencode')
    assert.equal(info.source, 'ui')
    delete process.env.OPENAI_API_KEY
  })

  check('非法配置会被拒绝', () => {
    assert.throws(() => saveAiConfig({ baseUrl: 'ftp://x', model: 'm', apiKey: 'k' }), /http/)
    assert.throws(() => saveAiConfig({ baseUrl: 'https://x', model: 'm', apiKey: '' }), /API Key/)
    assert.throws(() => saveAiConfig({ baseUrl: 'https://x', model: '', apiKey: 'k' }), /模型/)
  })

  check('清除后回退到未配置', () => {
    clearAiConfig()
    assert.equal(publicAiConfig().configured, false)
    assert.equal(aiProviderInfo().configured, false)
  })

  console.log(`\n✓ AI 配置断言全部通过（${passed} 项）`)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
