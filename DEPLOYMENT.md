# ClawPaw 部署记录

## 架构总览

```
手机 App (JSch)
    │
    ▼ SSH 反向隧道
K8s 工作节点 (47.250.13.82) sshd:22
    │ 绑定 127.0.0.1:9000
    ▼
Backend Pod (K8s) → adb connect 127.0.0.1:9000
    ▲
    │ HTTP/WS
    ▼
Nginx Ingress → SLB (47.250.58.81)
    ▲
    │ ws://www.clawpaw.me
手机 App (WsClient)
```

## 云资源（吉隆坡 ap-southeast-3）

| 资源 | ID / 地址 | 说明 |
|------|-----------|------|
| ACK 集群 | c9a4e63ce0b3449e49c84b4072553b806 | K8s 集群 |
| SLB (Nginx Ingress) | lb-8psop1cpuw9orvb5bq09o / `47.250.58.81` | Web 入口 |
| 工作节点 EIP | eip-8psmvpximk16lsklhxrf3 / `47.250.13.82` | SSH 隧道入口 |
| 工作节点 (sshd) | i-8psixwih7h25tdpv4pza / 内网 `10.209.90.188` | K8s Node |
| RDS MySQL | rm-uf6bf5y3aagzpd67xro.mysql.rds.aliyuncs.com | 数据库 |
| ACR 镜像仓库 | thinkingme-registry.cn-shanghai.cr.aliyuncs.com/thinkeme/clawpaw | 后端镜像 |

## 域名

- `www.clawpaw.me` → `47.250.58.81` (SLB)
- SSH 隧道 host → `47.250.13.82` (节点 EIP，**不是** www.clawpaw.me)

## K8s 资源配置

### Deployment (clawpaw-backend)
- Image: `thinkingme-registry.cn-shanghai.cr.aliyuncs.com/thinkeme/clawpaw:<sha>`
- Port: 3000
- **待做**: 加 `hostNetwork: true` + `dnsPolicy: ClusterFirstWithHostNet`（这样后端容器才能访问节点上 127.0.0.1:9000 的 SSH 隧道）

### Service (clawpaw)
- Type: ClusterIP
- Selector: `app: clawpaw-backend`
- Port: 3000

### Ingress (clawpaw)
- IngressClassName: nginx
- Host: `www.clawpaw.me`
- Path: `/` → Service `clawpaw:3000`

## 节点 sshd 配置 (/etc/ssh/sshd_config)

```
PasswordAuthentication yes
GatewayPorts yes
AllowTcpForwarding yes
ClientAliveInterval 30
ClientAliveCountMax 8

Match User cp_*
    PasswordAuthentication yes
    AuthorizedKeysCommand none
    AuthorizedKeysCommandUser none
```

## 安全组规则 (sg-8ps7spz05mb57zphyun9)

| 方向 | 协议 | 端口 | 来源 |
|------|------|------|------|
| 入 | TCP | 22 | 0.0.0.0/0 |
| 入 | TCP | 80 | 0.0.0.0/0 |
| 入 | TCP | 443 | 0.0.0.0/0 |

## 遗留问题 / 待做

### 1. hostNetwork 问题
Backend pod 在 K8s 容器内，`127.0.0.1:9000` 指向的是容器自身，不是宿主机。
需要在 Deployment 里加：
```yaml
spec:
  template:
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
```
否则 `adb connect 127.0.0.1:9000` 无法连到 SSH 隧道。

### 2. SSH 用户自动创建问题
后端 `ssh_provision.service.ts` 里的 `useradd`/`chpasswd` 在容器内执行，
创建的是容器内用户，**不是宿主节点用户**。
需要改成：通过某种方式在节点上创建用户，选项：
- 后端通过 SSH/API 在节点上执行 useradd
- 节点上运行一个 DaemonSet agent 接收用户创建请求
- 用 K8s API 在节点上执行命令

当前临时方案：手动在节点上执行 useradd。

### 3. SSH host 配置
当前节点 EIP `47.250.13.82` 是手动绑定的，
如果节点重建或换节点，EIP 需要重新绑定。
长远方案：给 SSH host 单独配一个域名（如 `ssh.clawpaw.me`），
指向节点 EIP，方便以后迁移。

### 4. 后端 SSH provision 流程
`POST /api/ssh/provision` 目前调用 `useradd`/`chpasswd` 但在容器内无效。
需要重新设计这个流程。

## 本地开发

```bash
# 后端
cd web/backend && npm run dev   # port 3000

# Android (连真机)
# Android Studio → 选小米手机 → Run
# WS_URL=ws://www.clawpaw.me (已配置)
# SSH host 默认 47.250.13.82
```

## CI/CD

- Push 到 `main` 分支 → GitHub Actions 构建 Docker 镜像 → 推送到 ACR
- 工作流: `.github/workflows/backend-acr.yml`
- 部署: 手动在 ACK 控制台更新镜像版本（或配置 ArgoCD/自动滚动更新）

## 数据库 Schema

```sql
users (uid, login_type, login_id, created_at, updated_at)
clawpaw_secrets (uid, secret, created_at, updated_at)
ssh_credentials (uid, username, linux_password, adb_port, created_at, updated_at)
```
