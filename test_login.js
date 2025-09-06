const axios = require('axios');

async function testLogin() {
  try {
    console.log('测试登录功能...');
    
    // 测试登录API
    const response = await axios.post('http://localhost:3001/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    });
    
    console.log('登录成功！');
    console.log('用户信息:', response.data.user);
    console.log('Token:', response.data.token.substring(0, 50) + '...');
    
    // 测试受保护的API
    const token = response.data.token;
    const protectedResponse = await axios.get('http://localhost:3001/api/customers', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('受保护API测试成功！');
    console.log('客户数量:', protectedResponse.data.data?.length || 0);
    
  } catch (error) {
    console.error('测试失败:', error.response?.data || error.message);
  }
}

testLogin();
