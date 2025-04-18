const helloWorld = require('../path/to/helloWorld'); 
test('returns "Hello, World!"', () => {
	expect(helloWorld()).toBe('Hello, World!');
});