# Model providers

Xiryn talks to models through the [AI SDK](https://ai-sdk.dev). Configure as many providers as you like — in `.env` or **Settings → Providers** — and pick a model per agent or a workspace default.

Models are always written `provider/model-id`. Only the first slash separates the two, so ids that contain slashes (OpenRouter) work as-is.

## Choosing a model

Agents use tools constantly. Pick a model that supports **tool calling**. For desktop work (`screen_capture`, clicking, typing) it must also accept **image input**. Strong reasoning helps with long, multi-step tasks; fast, cheap models are fine for chatty agents without a workstation.

The model picker lists what your key can actually use, fetched live from the provider, and accepts any id you type.

## Hosted providers

| Provider | Variable | Example model | Get a key |
| --- | --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `openai/gpt-6-luna` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-5-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Google Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` | pick from the live list | [aistudio.google.com](https://aistudio.google.com/apikey) |
| xAI | `XAI_API_KEY` | pick from the live list | [console.x.ai](https://console.x.ai) |
| Groq | `GROQ_API_KEY` | pick from the live list | [console.groq.com](https://console.groq.com/keys) |
| Mistral | `MISTRAL_API_KEY` | pick from the live list | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| DeepSeek | `DEEPSEEK_API_KEY` | pick from the live list | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter/<vendor>/<model>` | [openrouter.ai](https://openrouter.ai/keys) |
| Amazon Bedrock | instance role, or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | `bedrock/eu.anthropic.claude-sonnet-5-5` | [IAM for Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html) |

Each hosted provider also accepts a `<PROVIDER>_BASE_URL` (e.g. `OPENAI_BASE_URL`) for proxies or regional endpoints. Bedrock's optional endpoint is `BEDROCK_BASE_URL` (a VPC endpoint). Its region is `AWS_REGION`, default `eu-west-3`.

## Amazon Bedrock

Bedrock is a normal provider: streaming and tool calling go through the same AI SDK path as the others. Pick a model as `bedrock/<inference-profile-id>`.

**Credentials.** With no access key saved, calls use the [AWS SDK default chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html): an EC2 instance role, `AWS_PROFILE`, ECS container credentials, or web identity. On the EC2 host in `docs/aws.md`, attach a role and set `AWS_REGION=eu-west-3` — no keys in `.env`. To use keys instead, set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (and `AWS_SESSION_TOKEN` when the keys are temporary), or paste them in **Settings → Providers → Amazon Bedrock**.

Bedrock stays off until one of these is true: both keys are set, `AWS_REGION` is set in the environment, a region is saved in Settings, or another credential-chain variable is present (`AWS_PROFILE`, container credentials, web identity). The built-in region default does not turn it on, so an install that never mentions AWS is unchanged.

**Models for eu-west-3.** These are EU geographic inference profile ids. Each model's AWS card lists Paris (`eu-west-3`) as a source region, checked 22 October 2026. Requests stay in EU destination regions. You still need to enable model access once in the Bedrock console (Anthropic's first-time use form).

| Model | Id |
| --- | --- |
| Claude Sonnet 5.5 | `bedrock/eu.anthropic.claude-sonnet-5-5` |
| Claude Haiku 5.5 | `bedrock/eu.anthropic.claude-haiku-5-5` |
| Claude Sonnet 4.6 | `bedrock/eu.anthropic.claude-sonnet-4-6` |
| Claude Haiku 4.5 | `bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0` |
| Amazon Nova Pro | `bedrock/eu.amazon.nova-pro-v1:0` |
| Amazon Nova Lite | `bedrock/eu.amazon.nova-lite-v1:0` |
| Amazon Nova Micro | `bedrock/eu.amazon.nova-micro-v1:0` |

**Test connection** lists inference profiles in `AWS_REGION`, then profiles and on-demand models in each extra region. Output tokens are capped per model: 16,384 by default (Claude Sonnet 4.6 accepts that), 10,000 for Nova Pro, Lite and Micro, and 4,096 for Llama 3.3 70B Instruct. Override one id with `XIRYN_BEDROCK_MAX_OUTPUT=eu.amazon.nova-pro-v1:0=8000`.

## Models in another region

The default region stays `AWS_REGION`. To also call models that are not in that region, name the other regions:

```bash
XIRYN_BEDROCK_EXTRA_REGIONS=us-east-2
```

With `us-east-2` listed, the picker shows **Llama 3.3 70B (Ohio)**. Select:

```text
bedrock/meta.llama3-3-70b-instruct-v1:0
```

That id is the on-demand model in Ohio, so the call stays in `us-east-2`. The US profile `us.meta.llama3-3-70b-instruct-v1:0` also shows up once the live list returns; invoking it from Ohio is allowed, and Bedrock may serve it from us-east-1, us-east-2, or us-west-2. EU models such as `bedrock/eu.anthropic.claude-sonnet-4-6` keep using `eu-west-3`.

Pin any other id yourself:

```bash
XIRYN_BEDROCK_MODEL_REGIONS=some.model-id=us-east-2
```

`BEDROCK_BASE_URL`, when set, is the endpoint for the default region only.

Llama 3.3 70B Instruct's model card says tool use and streaming cannot be combined (`ConverseStream` plus tools returns "This model doesn't support tool use in streaming mode"). Chat still streams. A step that calls tools uses the non-streaming Converse API, which sends `toolConfig` and reads `toolUse` blocks. Llama 3.x often still prints the call as text (`{"type":"function","name":"shell","parameters":{...}}`, `<|python_tag|>`, or a code fence). Xiryn turns that text into a real tool call, runs it, and continues to a final answer. The tool step arrives in one piece rather than token by token.

The Usage page prices these ids from `lib/providers/pricing.ts`.

An id with its own row is a catalog price. `eu.` Nova rates are the public eu-west-3 on-demand prices from the Amazon Bedrock price list published 16 October 2026, checked again on 23 October 2026. On that list, `us.` Nova Pro, Lite, and Micro (us-east-1, us-east-2, and us-west-2) are cheaper than Paris, so those three ids have their own rows. Asia Pacific prices differ by region, and Nova 1 has no global cross-region price, so `apac.`, `global.`, and unprefixed Nova ids stay unpriced until you set one.

Claude on Bedrock is billed through AWS Marketplace and is not in that price list. The `eu.` rows match Anthropic's published rates already used for the Anthropic provider. A `us.`, `global.`, or `apac.` profile of the same Claude model, or the id with no geographic prefix, reuses the `eu.` row as an **estimate**. The Usage page labels it estimate. The public list does not publish a geographic premium for these Claude ids, so none is guessed — an estimate can under-count. `us-gov.` and any other prefix stay unpriced.

A custom price, set on the Usage page for that exact id, overrides a catalog row or an estimate. Clearing it restores the built-in rate. Models with neither a row nor a custom price show tokens and no dollar amount.

## Local models

Run models on your own hardware and nothing — not even the prompt — leaves your machine except workstation and web calls.

### Ollama

The quickest way: in the Xiryn folder, run

```bash
npm run setup:local
```

It installs Ollama if it's missing (asking first), starts it, downloads a model that fits your computer's memory and makes it the default for every agent. To choose the model yourself: `npm run setup -- --local --model=gemma4:e4b`.

From the app, **Settings → Local models** shows whether Ollama is running, lists your downloaded models, downloads new ones with a progress bar (any name from [ollama.com/library](https://ollama.com/library)) and makes one the default in a click.

By hand:

```bash
ollama pull qwen3.5:9b
```

```bash
# .env
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
XIRYN_DEFAULT_MODEL=ollama/qwen3.5:9b
```

Agents need a model with tool calling; one with vision also lets them see their desktop. These work well:

| Model | Download | Fits |
| --- | --- | --- |
| `qwen3.5:2b` | 2.7 GB | any computer — chat and simple tasks |
| `qwen3.5:4b` | 3.3 GB | 12 GB of memory and up |
| `gemma4:e4b` | 6.6 GB | 16 GB and up |
| `qwen3.5:9b` | 6.6 GB | 20 GB and up — better reasoning and desktop use |
| `qwen3.6:27b` | about 17 GB | 40 GB and up — the strongest |

Replies on local models are marked *free* and never count toward the monthly budget.

**Context size.** Unless a model says otherwise, Ollama runs it with a small context (4K on many machines) and silently cuts longer prompts — and an agent's instructions alone are several thousand tokens. Ollama's OpenAI-style endpoint can't ask for more per request, so Xiryn saves a larger context on the model itself, as a Modelfile's `PARAMETER num_ctx` would: 32K (16K on computers with under 12 GB of memory). It does this for models it downloads or makes the default, and checks any other Ollama model once before its first turn. Settings → Local models shows each model's context.

### LM Studio

Start the local server in LM Studio (Developer → Start server), then:

```bash
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
```

Use `lmstudio/<model-id>` as shown in the picker.

## Any OpenAI-compatible API

vLLM, LiteLLM, Together, Fireworks, a corporate gateway — anything that speaks the OpenAI chat completions API:

```bash
CUSTOM_BASE_URL=https://your-endpoint/v1
CUSTOM_API_KEY=...        # if required
```

Use `custom/<model-id>`.

## Defaults

```bash
XIRYN_DEFAULT_MODEL=openai/gpt-6-luna   # used by agents without their own model
XIRYN_MAX_STEPS=40                      # max tool calls per turn
```

Without `XIRYN_DEFAULT_MODEL`, Xiryn uses the first recommended model of the first configured provider.

## Costs

Xiryn is free; providers bill you directly. The **Usage** page shows input, output, cached and reasoning tokens per turn, model and agent, and what that cost.

A model is priced in one of three ways:

- **Catalog** — a published rate shipped with Xiryn.
- **Estimate** — a Bedrock id that has no row of its own but matches an `eu.` model. The page labels it estimate. It can under-count; the provider's bill is the final word.
- **Custom** — a rate you set on the Usage page for that exact id, in US dollars per million tokens. It overrides the catalog and any estimate. Remove it to go back.

Anything else shows its tokens and no price. Set spending limits in your provider's dashboard as well.
