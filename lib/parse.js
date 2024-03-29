/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
var esprima = require("esprima");

// Syntax: https://developer.mozilla.org/en/SpiderMonkey/Parser_API

function walkStatements(options, context, statements) {
	statements.forEach(function(statement) {
		walkStatement(options, context, statement);
	});
}

function walkStatement(options, context, statement) {
	switch(statement.type) {
	// Real Statements
	case "BlockStatement":
		walkStatements(options, context, statement.body);
		break;
	case "ExpressionStatement":
		walkExpression(options, context, statement.expression);
		break;
	case "IfStatement":
		walkExpression(options, context, statement.test);
		walkStatement(options, context, statement.consequent);
		if(statement.alternate)
			walkStatement(options, context, statement.alternate);
		break;
	case "LabeledStatement":
		walkStatement(options, context, statement.body);
		break;
	case "WithStatement":
		walkExpression(options, context, statement.object);
		walkStatement(options, context, statement.body);
		break;
	case "SwitchStatement":
		walkExpression(options, context, statement.discriminant);
		walkSwitchCases(options, context, statement.cases);
		break;
	case "ReturnStatement":
	case "ThrowStatement":
		if(statement.argument)
			walkExpression(options, context, statement.argument);
		break;
	case "TryStatement":
		var oldInTry = context.inTry;
		context.inTry = true;
		walkStatement(options, context, statement.block);
		context.inTry = oldInTry;
		walkCatchClauses(options, context, statement.handlers);
		if(statement.finalizer)
			walkStatement(options, context, statement.finalizer);
		break;
	case "WhileStatement":
	case "DoWhileStatement":
		walkExpression(options, context, statement.test);
		walkStatement(options, context, statement.body);
		break;
	case "ForStatement":
		if(statement.init) {
			if(statement.init.type === "VariableDeclaration")
				walkStatement(options, context, statement.init);
			else
				walkExpression(options, context, statement.init);
		}
		if(statement.test)
			walkExpression(options, context, statement.test);
		if(statement.update)
			walkExpression(options, context, statement.update);
		walkStatement(options, context, statement.body);
		break;
	case "ForInStatement":
		if(statement.left.type === "VariableDeclaration")
			walkStatement(options, context, statement.left);
		else
			walkExpression(options, context, statement.left);
		walkExpression(options, context, statement.right);
		walkStatement(options, context, statement.body);
		break;

	// Declarations
	case "FunctionDeclaration":
		if(options.overwrites.hasOwnProperty(statement.id.name)) {
			context.overwrite.push(statement.id.name);
		}
		var oldInTry = context.inTry;
		context.inTry = false;
		var old = addOverwrites(options, context, statement.params);
		if(statement.body.type === "BlockStatement")
			walkStatement(options, context, statement.body);
		else
			walkExpression(options, context, statement.body);
		context.overwrite.length = old;
		context.inTry = oldInTry;
		break;
	case "VariableDeclaration":
		if(statement.declarations)
			walkVariableDeclarators(options, context, statement.declarations);
		break;
	}
}

function walkSwitchCases(options, context, switchCases) {
	switchCases.forEach(function(switchCase) {
		if(switchCase.test)
			walkExpression(options, context, switchCase.test);
		walkStatements(options, context, switchCase.consequent);
	});
}

function walkCatchClauses(options, context, catchClauses) {
	catchClauses.forEach(function(catchClause) {
		if(catchClause.guard)
			walkExpression(options, context, catchClause.guard);
		walkStatement(options, context, catchClause.body);
	});
}

function walkVariableDeclarators(options, context, declarators) {
	declarators.forEach(function(declarator) {
		switch(declarator.type) {
		case "VariableDeclarator":
			if(declarator.id.type === "Identifier" &&
				options.overwrites.hasOwnProperty(declarator.id.name)) {
				context.overwrite.push(declarator.id.name);
			}
			if(declarator.init)
				walkExpression(options, context, declarator.init);
			break;
		}
	});
}

function walkExpressions(options, context, expressions) {
	expressions.forEach(function(expression) {
		walkExpression(options, context, expression);
	});
}

function walkExpression(options, context, expression) {
	switch(expression.type) {
	case "ArrayExpression":
		if(expression.elements)
			walkExpressions(options, context, expression.elements);
		break;
	case "ObjectExpression":
		expression.properties.forEach(function(prop) {
			walkExpression(options, context, prop.value);
		});
		break;
	case "FunctionExpression":
		var oldInTry = context.inTry;
		context.inTry = false;
		var old = addOverwrites(options, context, expression.params);
		if(expression.body.type === "BlockStatement")
			walkStatement(options, context, expression.body);
		else
			walkExpression(options, context, expression.body);
		context.overwrite.length = old;
		context.inTry = oldInTry;
		break;
	case "SequenceExpression":
		if(expression.expressions)
			walkExpressions(options, context, expression.expressions);
		break;
	case "UpdateExpression":
		walkExpression(options, context, expression.argument);
		break;
	case "UnaryExpression":
		if(expression.operator === "typeof" &&
			expression.argument &&
			expression.argument.type === "Identifier" &&
			expression.argument.name === "require")
			break;
		if(expression.operator === "typeof" &&
			expression.argument &&
			expression.argument.type === "Identifier" &&
			expression.argument.name === "module")
			break;
		walkExpression(options, context, expression.argument);
		break;
	case "BinaryExpression":
	case "LogicalExpression":
		walkExpression(options, context, expression.left);
		walkExpression(options, context, expression.right);
		break;
	case "AssignmentExpression":
		if(expression.left.type !== "Identifier" ||
			expression.left.name !== "require")
			walkExpression(options, context, expression.left);
		walkExpression(options, context, expression.right);
		break;
	case "ConditionalExpression":
		walkExpression(options, context, expression.test);
		walkExpression(options, context, expression.alternate);
		walkExpression(options, context, expression.consequent);
		break;
	case "NewExpression":
		walkExpression(options, context, expression.callee);
		if(expression.arguments)
			walkExpressions(options, context, expression.arguments);
		break;
	case "CallExpression":
		var noCallee = false;
		function processAmdArray(params, elements) {
			params.forEach(function(param, idx) {
				if(param.conditional) {
					context.requires = context.requires || [];
					param.conditional.forEach(function(paramItem) {
						context.requires.push({
							name: paramItem.value,
							expressionRange: paramItem.range,
							line: elements[idx].loc.start.line,
							column: elements[idx].loc.start.column,
							inTry: context.inTry
						});
					});
				} else if(param.code) {
					// make context
					var pos = param.value.indexOf("/");
					context.contexts = context.contexts || [];
					if(pos === -1) {
						var newContext = {
							name: ".",
							valueRange: elements[idx].range,
							line: elements[idx].loc.start.line,
							column: elements[idx].loc.start.column
						};
						context.contexts.push(newContext);
					} else {
						var match = /\/[^\/]*$/.exec(param.value);
						var dirname = param.value.substring(0, match.index);
						var remainder = "." + param.value.substring(match.index);
						var newContext = {
							name: dirname,
							replace: [param.range, remainder],
							valueRange: elements[idx].range,
							line: elements[idx].loc.start.line,
							column: elements[idx].loc.start.column
						};
						context.contexts.push(newContext);
					}
				} else if(param.value == "require") {
					// require function
					context.requires = context.requires || [];
					context.requires.push({
						requireFunction: true,
						expressionRange: elements[idx].range,
						line: elements[idx].loc.start.line,
						column: elements[idx].loc.start.column,
						inTry: context.inTry
					});
				} else if(param.value == "exports") {
					// exports
					context.requires = context.requires || [];
					context.requires.push({
						moduleExports: true,
						expressionRange: elements[idx].range,
						line: elements[idx].loc.start.line,
						column: elements[idx].loc.start.column,
						inTry: context.inTry
					});
				} else {
					// normal require
					context.requires = context.requires || [];
					context.requires.push({
						name: param.value,
						expressionRange: elements[idx].range,
						line: elements[idx].loc.start.line,
						column: elements[idx].loc.start.column,
						inTry: context.inTry
					});
				}
			});
		}
		// AMD require.config
		if(context.overwrite.indexOf("require") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length == 1 &&
			expression.callee.type === "MemberExpression" &&
			expression.callee.object.type === "Identifier" &&
			expression.callee.object.name === "require" &&
			expression.callee.property.type === "Identifier" &&
			expression.callee.property.name === "config") {
			context.requires = context.requires || [];
			context.requires.push({
				name: "__webpack_amd_require",
				line: expression.callee.loc.start.line,
				column: expression.callee.loc.start.column,
				variable: "require"
			});
			noCallee = true;
		}
		// AMD require
		if(context.overwrite.indexOf("require") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length >= 1 &&
			expression.arguments.length <= 2 &&
			expression.callee.type === "Identifier" &&
			expression.callee.name === "require" &&
			expression.arguments[0].type === "ArrayExpression") {
			context.requires = context.requires || [];
			context.requires.push({
				name: "__webpack_amd_require",
				line: expression.callee.loc.start.line,
				column: expression.callee.loc.start.column,
				variable: "require"
			});
			var newContext = {
				requires: [],
				amdRange: expression.arguments[0].range,
				line: expression.loc.start.line,
				column: expression.loc.start.column,
				ignoreOverride: true,
				overwrite: context.overwrite.slice(),
				options: options
			};
			if(expression.arguments.length >= 2 &&
				expression.arguments[1].type === "FunctionExpression" &&
				expression.arguments[1].body &&
				expression.arguments[1].body.type === "BlockStatement" &&
				expression.arguments[1].body.range)
				newContext.blockRange = [
					expression.arguments[1].body.range[0]+1,
					expression.arguments[1].body.range[1]-1
				];
			context.asyncs = context.asyncs || [];
			context.asyncs.push(newContext);
			context = newContext;
			var params = parseCalculatedStringArray(expression.arguments[0]);
			var elements = expression.arguments[0].elements;
			processAmdArray(params, elements);
			noCallee = true;
		}
		// AMD define
		if(context.overwrite.indexOf("define") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length == 2 &&
			expression.callee.type === "Identifier" &&
			expression.callee.name === "define") {
			var amdNameRange;

			if(expression.arguments[0].type == "ArrayExpression") {
				var params = parseCalculatedStringArray(expression.arguments[0]);
				var elements = expression.arguments[0].elements;
				processAmdArray(params, elements);
			} else {
				amdNameRange = expression.arguments[0].range;
			}
			context.requires = context.requires || [];
			context.requires.push({
				name: "__webpack_amd_define",
				append: "(module)",
				line: expression.callee.loc.start.line,
				column: expression.callee.loc.start.column,
				amdNameRange: amdNameRange,
				label: expression.arguments[0].value,
				variable: "define"
			});
			noCallee = true;
		}
		// AMD define
		if(context.overwrite.indexOf("define") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length == 1 &&
			expression.callee.type === "Identifier" &&
			expression.callee.name === "define") {
			context.requires = context.requires || [];
			context.requires.push({
				name: "__webpack_amd_define",
				append: "(module)",
				line: expression.callee.loc.start.line,
				column: expression.callee.loc.start.column,
				variable: "define"
			});
			context.ignoreOverride = true;
			noCallee = true;
		}
		if(context.overwrite.indexOf("define") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length == 3 &&
			expression.callee.type === "Identifier" &&
			expression.callee.name === "define") {
			var params = parseCalculatedStringArray(expression.arguments[1]);
			var elements = expression.arguments[1].type == "ArrayExpression" ?
				expression.arguments[1].elements : [expression.arguments[1]];
			processAmdArray(params, elements);
			context.requires = context.requires || [];
			context.requires.push({
				name: "__webpack_amd_define",
				append: "(module)",
				amdNameRange: expression.arguments[0].range,
				label: expression.arguments[0].value+"",
				line: expression.callee.loc.start.line,
				column: expression.callee.loc.start.column,
				variable: "define"
			});
			noCallee = true;
		}
		// CommonJS
		if(context.overwrite.indexOf("require") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length == 1 &&
			expression.callee.type === "Identifier" &&
			expression.callee.name === "require" &&
			expression.arguments[0].type !== "ArrayExpression") {
			// "require(...)"
			var param = parseCalculatedString(expression.arguments[0]);
			if(param.conditional) {
				context.requires = context.requires || [];
				param.conditional.forEach(function(paramItem) {
					context.requires.push({
						name: paramItem.value,
						valueRange: paramItem.range,
						line: expression.loc.start.line,
						column: expression.loc.start.column,
						inTry: context.inTry
					});
				});
			} else if(param.code) {
				// make context
				var pos = param.value.indexOf("/");
				context.contexts = context.contexts || [];
				if(pos === -1) {
					var newContext = {
						name: ".",
						require: true,
						calleeRange: expression.callee.range,
						line: expression.loc.start.line,
						column: expression.loc.start.column
					};
					context.contexts.push(newContext);
				} else {
					var match = /\/[^\/]*$/.exec(param.value);
					var dirname = param.value.substring(0, match.index);
					var remainder = "." + param.value.substring(match.index);
					var newContext = {
						name: dirname,
						require: true,
						replace: [param.range, remainder],
						calleeRange: expression.callee.range,
						line: expression.loc.start.line,
						column: expression.loc.start.column
					};
					context.contexts.push(newContext);
				}
			} else {
				// normal require
				context.requires = context.requires || [];
				context.requires.push({
					name: param.value,
					idOnly: true,
					expressionRange: expression.arguments[0].range,
					line: expression.loc.start.line,
					column: expression.loc.start.column,
					inTry: context.inTry
				});
			}
			noCallee = true;
		}
		// require.ensure
		if(context.overwrite.indexOf("require") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length >= 1 &&
			expression.callee.type === "MemberExpression" &&
			expression.callee.object.type === "Identifier" &&
			expression.callee.object.name === "require" &&
			expression.callee.property.type === "Identifier" &&
			{async:1, ensure:1}.hasOwnProperty(expression.callee.property.name)) {
			// "require.ensure(...)" or "require.async(...)"
			var param = parseStringArray(expression.arguments[0]);
			var newContext = {
				requires: [],
				propertyRange: expression.callee.property.range,
				namesRange: expression.arguments[0].range,
				line: expression.loc.start.line,
				column: expression.loc.start.column,
				ignoreOverride: true,
				overwrite: context.overwrite.slice(),
				options: options
			};
			param.forEach(function(r) {
				newContext.requires.push({name: r});
			});
			if(expression.arguments.length >= 2 &&
				expression.arguments[1].type === "FunctionExpression" &&
				expression.arguments[1].body &&
				expression.arguments[1].body.type === "BlockStatement" &&
				expression.arguments[1].body.range)
				newContext.blockRange = [
					expression.arguments[1].body.range[0]+1,
					expression.arguments[1].body.range[1]-1
				];
			if(expression.arguments[2]) {
				newContext.name = parseString(expression.arguments[2]);
				newContext.nameRange = expression.arguments[2].range;
			}
			context.asyncs = context.asyncs || [];
			context.asyncs.push(newContext);
			context = newContext;
			noCallee = true;
		}
		// (non-standard) require.context
		if(context.overwrite.indexOf("require") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length == 1 &&
			expression.callee.type === "MemberExpression" &&
			expression.callee.object.type === "Identifier" &&
			expression.callee.object.name === "require" &&
			expression.callee.property.type === "Identifier" &&
			expression.callee.property.name === "context") {
			// "require.context(...)"
			var param = parseString(expression.arguments[0]);
			context.contexts = context.contexts || [];
			var newContext = {
				name: param,
				expressionRange: expression.arguments[0].range,
				calleeRange: expression.callee.range,
				line: expression.loc.start.line,
				column: expression.loc.start.column
			};
			context.contexts.push(newContext);
			noCallee = true;
		}
		// CommonJS: require.resolve
		if(context.overwrite.indexOf("require") === -1 &&
			expression.callee && expression.arguments &&
			expression.arguments.length == 1 &&
			expression.callee.type === "MemberExpression" &&
			expression.callee.object.type === "Identifier" &&
			expression.callee.object.name === "require" &&
			expression.callee.property.type === "Identifier" &&
			expression.callee.property.name === "resolve") {
			// "require.resolve(...)"
			var param = parseCalculatedString(expression.arguments[0]);
			if(param.conditional) {
				context.requires = context.requires || [];
				param.conditional.forEach(function(paramItem, idx) {
					context.requires.push({
						name: paramItem.value,
						valueRange: paramItem.range,
						deleteRange: idx === 0 ? expression.callee.range : undefined,
						line: expression.loc.start.line,
						column: expression.loc.start.column
					});
				});
			} else {
				// normal require
				context.requires = context.requires || [];
				context.requires.push({
					name: param.value,
					expressionRange: [expression.callee.range[0], expression.range[1]],
					idOnly: true,
					brackets: true,
					line: expression.loc.start.line,
					column: expression.loc.start.column
				});
			}
			noCallee = true;
		}

		if(expression.callee && !noCallee)
			walkExpression(options, context, expression.callee);
		if(expression.arguments)
			walkExpressions(options, context, expression.arguments);
		break;
	case "MemberExpression":
		if(expression.object.type === "Identifier" &&
			expression.object.name === "module" &&
			expression.property.type === "Identifier" &&
			{exports:1, id:1, loaded:1}.hasOwnProperty(expression.property.name))
			break;
		if(expression.object.type === "Identifier" &&
			expression.object.name === "require" &&
			expression.property.type === "Identifier")
			break;
		walkExpression(options, context, expression.object);
		if(expression.property.type !== "Identifier")
			walkExpression(options, context, expression.property);
		break;
	case "Identifier":
		if(context.overwrite.indexOf("require") === -1 &&
			expression.name === "require") {
			context.contexts = context.contexts || [];
			var newContext = {
				name: ".",
				warn: "Identifier",
				require: true,
				calleeRange: [expression.range[0], expression.range[1]],
				line: expression.loc.start.line,
				column: expression.loc.start.column
			};
			context.contexts.push(newContext);
		} else if(context.overwrite.indexOf(expression.name) === -1 &&
			options.overwrites.hasOwnProperty(expression.name)) {
			context.requires = context.requires || [];
			var overwrite = options.overwrites[expression.name];
			var append = undefined;
			if(overwrite.indexOf("+") !== -1) {
				append = overwrite.substr(overwrite.indexOf("+")+1);
				overwrite = overwrite.substr(0, overwrite.indexOf("+"));
			}
			context.requires.push({
				name: overwrite,
				line: expression.loc.start.line,
				column: expression.loc.start.column,
				variable: expression.name,
				append: append
			});
		}
		break;
	}
}

function addOverwrites(options, context, params) {
	var l = context.overwrite.length;
	if(!params) return l;
	params.forEach(function(param) {
		if(context.ignoreOverride) {
			context.ignoreOverride = false;
			return;
		}
		if(param.type === "Identifier" &&
			options.overwrites.hasOwnProperty(param.name))
			context.overwrite.push(param.name);
	});
	return l;
}

function parseString(expression) {
	switch(expression.type) {
	case "BinaryExpression":
		if(expression.operator == "+")
			return parseString(expression.left) + parseString(expression.right);
		break;
	case "Literal":
		return expression.value+"";
	}
	throw new Error(expression.type + " is not supported as parameter for require");
}

function parseCalculatedString(expression) {
	switch(expression.type) {
	case "BinaryExpression":
		if(expression.operator == "+") {
			var left = parseCalculatedString(expression.left);
			var right = parseCalculatedString(expression.right);
			if(left.code) {
				return {range: left.range, value: left.value, code: true};
			} else if(right.code) {
				return {range: [left.range[0], right.range ? right.range[1] : left.range[1]], value: left.value + right.value, code: true};
			} else {
				return {range: [left.range[0], right.range[1]], value: left.value + right.value};
			}
		}
		break;
	case "ConditionalExpression":
		var consequent = parseCalculatedString(expression.consequent);
		var alternate = parseCalculatedString(expression.alternate);
		var items = [];
		if(consequent.conditional)
			Array.prototype.push.apply(items, consequent.conditional);
		else if(!consequent.code)
			items.push(consequent);
		else break;
		if(alternate.conditional)
			Array.prototype.push.apply(items, alternate.conditional);
		else if(!alternate.code)
			items.push(alternate);
		else break;
		return {value: "", code: true, conditional: items};
	case "Literal":
		return {range: expression.range, value: expression.value+""};
		break;
	}
	return {value: "", code: true};
}

function parseStringArray(expression) {
	switch(expression.type) {
	case "ArrayExpression":
		var arr = [];
		if(expression.elements)
			expression.elements.forEach(function(expr) {
				arr.push(parseString(expr));
			});
		return arr;
	}
	return [parseString(expression)];
}

function parseCalculatedStringArray(expression) {
	switch(expression.type) {
	case "ArrayExpression":
		var arr = [];
		if(expression.elements)
			expression.elements.forEach(function(expr) {
				arr.push(parseCalculatedString(expr));
			});
		return arr;
	}
	return [parseCalculatedString(expression)];
}

module.exports = function parse(source, options) {
	var ast = esprima.parse(source, {range: true, loc: true, raw: true});
	if(!ast || typeof ast != "object")
		throw new Error("Source couldn't be parsed");
	options = options || {};
	options.overwrites = options.overwrites || {};
	options.overwrites.require = true;
	var context = {
		overwrite: []
	};
	walkStatements(options, context, ast.body);
	JSON.stringify(context);
	return context;
}