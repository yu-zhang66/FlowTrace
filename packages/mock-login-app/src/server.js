/**
 * Mock Login Application Server
 *
 * A simple Express-based login application for testing FlowTrace.
 * Supports both legacy and current login behaviors.
 */
import express from 'express';
import session from 'express-session';
// Valid test users
const VALID_USERS = [
    { username: 'supplier001', password: 'Supplier@123', role: 'supplier' },
    { username: 'supplier002', password: 'Supplier@456', role: 'supplier' },
    { username: 'admin', password: 'Admin@789', role: 'admin' },
];
// Create Express app
function createApp(config) {
    const app = express();
    // Middleware
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(session({
        secret: 'mock-login-secret-key',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 3600000 }
    }));
    // Store users
    app.locals.users = config.users.length > 0 ? config.users : VALID_USERS;
    app.locals.mode = config.mode;
    app.locals.errorSimulation = config.errorSimulation || {};
    // Login page
    app.get('/login', (req, res) => {
        const error = req.query.error;
        res.send(getLoginPageHtml(error, config.mode));
    });
    // Login POST handler
    app.post('/login', async (req, res) => {
        const { username, password } = req.body;
        const users = req.app.locals.users;
        const errorSim = req.app.locals.errorSimulation;
        // Simulate delay if configured
        if (errorSim.delay) {
            await new Promise(resolve => setTimeout(resolve, errorSim.delay));
        }
        // Simulate invalid username error
        if (errorSim.invalidUsername || username === 'INVALID_USERNAME') {
            return res.redirect('/login?error=invalid_username');
        }
        // Simulate invalid password error
        if (errorSim.invalidPassword || password === 'INVALID_PASSWORD') {
            return res.redirect('/login?error=invalid_password');
        }
        // Find user
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            // Login success
            req.session.user = user;
            return res.redirect('/dashboard');
        }
        else {
            // Invalid credentials
            return res.redirect('/login?error=invalid_credentials');
        }
    });
    // Dashboard (authenticated page)
    app.get('/dashboard', (req, res) => {
        const user = req.session?.user;
        if (!user) {
            return res.redirect('/login');
        }
        res.send(getDashboardHtml(user, config.mode));
    });
    // Logout
    app.post('/logout', (req, res) => {
        req.session.destroy(() => {
            res.redirect('/login');
        });
    });
    // Health check
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', mode: config.mode, timestamp: new Date().toISOString() });
    });
    return app;
}
function getLoginPageHtml(error, mode) {
    let errorMessage = '';
    let errorClass = '';
    if (error === 'invalid_username' || error === 'invalid_credentials') {
        errorMessage = mode === 'current'
            ? '用户名或密码不正确'
            : 'Invalid username or password';
        errorClass = 'error-message';
    }
    else if (error === 'invalid_password') {
        errorMessage = mode === 'current'
            ? '密码错误，请重新输入'
            : 'Incorrect password';
        errorClass = 'error-message';
    }
    const title = mode === 'current' ? '供应链管理系统 - 登录' : 'Supply Chain Management - Login';
    return `<!DOCTYPE html>
<html lang="${mode === 'current' ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .login-container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); width: 360px; }
    h1 { margin: 0 0 30px; font-size: 24px; color: #333; text-align: center; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; color: #666; font-weight: 500; }
    input[type="text"], input[type="password"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 14px; }
    input:focus { outline: none; border-color: #1890ff; }
    button { width: 100%; padding: 12px; background: #1890ff; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
    button:hover { background: #40a9ff; }
    .error-message { color: #ff4d4f; font-size: 14px; margin-bottom: 16px; padding: 12px; background: #fff2f0; border: 1px solid #ffccc7; border-radius: 4px; }
    .system-badge { position: absolute; top: 10px; right: 10px; padding: 4px 8px; background: ${mode === 'current' ? '#52c41a' : '#1890ff'}; color: white; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="login-container">
    <span class="system-badge">${mode === 'current' ? 'NEW' : 'LEGACY'}</span>
    <h1>${mode === 'current' ? '供应链管理系统' : 'Supply Chain System'}</h1>
    ${errorMessage ? `<div class="${errorClass}">${errorMessage}</div>` : ''}
    <form method="POST" action="/login">
      <div class="form-group">
        <label for="username">${mode === 'current' ? '用户名' : 'Username'}</label>
        <input type="text" id="username" name="username" required autocomplete="username">
      </div>
      <div class="form-group">
        <label for="password">${mode === 'current' ? '密码' : 'Password'}</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit">${mode === 'current' ? '登录' : 'Sign In'}</button>
    </form>
  </div>
</body>
</html>`;
}
function getDashboardHtml(user, mode) {
    const greeting = mode === 'current'
        ? `欢迎回来，${user.username}！`
        : `Welcome, ${user.username}!`;
    const roleLabel = mode === 'current' ? '角色' : 'Role';
    return `<!DOCTYPE html>
<html lang="${mode === 'current' ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - ${mode === 'current' ? '供应链管理' : 'Supply Chain'}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    .header { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    h1 { margin: 0; font-size: 24px; color: #333; }
    .user-info { display: flex; align-items: center; gap: 20px; }
    .role-badge { background: #e6f7ff; color: #1890ff; padding: 4px 12px; border-radius: 4px; font-size: 14px; }
    .logout-btn { padding: 8px 16px; background: #ff4d4f; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 20px; }
    .card h2 { margin: 0 0 16px; font-size: 18px; color: #333; }
    .system-badge { background: ${mode === 'current' ? '#52c41a' : '#1890ff'}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${mode === 'current' ? '供应链管理系统' : 'Supply Chain System'}</h1>
      <div class="user-info">
        <span class="system-badge">${mode === 'current' ? 'NEW' : 'LEGACY'}</span>
        <span>${greeting}</span>
        <span class="role-badge">${roleLabel}: ${user.role}</span>
        <form method="POST" action="/logout" style="display: inline;">
          <button type="submit" class="logout-btn">${mode === 'current' ? '退出登录' : 'Logout'}</button>
        </form>
      </div>
    </div>
    <div class="card">
      <h2>${mode === 'current' ? '我的工作台' : 'My Dashboard'}</h2>
      <p>${mode === 'current'
        ? '您已成功登录供应链管理系统，可以开始处理日常业务。'
        : 'You are now logged in to the Supply Chain Management System.'}</p>
    </div>
  </div>
</body>
</html>`;
}
// Start server
function startServer(config) {
    const app = createApp(config);
    app.listen(config.port, () => {
        console.log(`Mock Login App [${config.mode.toUpperCase()}] running at ${config.baseUrl}`);
        console.log(`  - Login page: ${config.baseUrl}/login`);
        console.log(`  - Health check: ${config.baseUrl}/health`);
        console.log(`\nTest credentials:`);
        config.users.forEach(u => {
            console.log(`  - ${u.username} / ${u.password} (${u.role})`);
        });
    });
}
// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const mode = (args.includes('--current') ? 'current' : 'legacy');
    const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '3000');
    const baseUrl = args.find(a => a.startsWith('--url='))?.split('=')[1] || `http://localhost:${port}`;
    const config = {
        port,
        baseUrl,
        mode,
        users: VALID_USERS,
        errorSimulation: {}
    };
    startServer(config);
}
export { createApp, startServer };
//# sourceMappingURL=server.js.map