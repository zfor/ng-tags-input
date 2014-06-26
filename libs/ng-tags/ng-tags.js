//<editor-fold defaultstate="collapsed" desc="ui.bootdtrap/typeahead">
/*
 * angular-ui-bootstrap
 * http://angular-ui.github.io/bootstrap/
 
 * Version: 0.10.0 - 2014-01-14
 * License: MIT
 */
angular.module("ui.bootstrap.custom", ["ui.bootstrap.custom.tpls", "ui.bootstrap.custom.position", "ui.bootstrap.custom.bindHtml", "ui.bootstrap.custom.typeahead"]);
angular.module("ui.bootstrap.custom.tpls", ["template/typeahead/typeahead-match.html", "template/typeahead/typeahead-popup.html"]);
angular.module('ui.bootstrap.custom.position', [])
        /**
         * A set of utility methods that can be use to retrieve position of DOM elements.
         * It is meant to be used where we need to absolute-position DOM elements in
         * relation to other, existing elements (this is the case for tooltips, popovers,
         * typeahead suggestions etc.).
         */
        .factory('$position', ['$document', '$window', function($document, $window) {
                function getStyle(el, cssprop) {
                    if (el.currentStyle) { //IE
                        return el.currentStyle[cssprop];
                    } else if ($window.getComputedStyle) {
                        return $window.getComputedStyle(el)[cssprop];
                    }
                    // finally try and get inline style
                    return el.style[cssprop];
                }

                /**
                 * Checks if a given element is statically positioned
                 * @param element - raw DOM element
                 */
                function isStaticPositioned(element) {
                    return (getStyle(element, "position") || 'static') === 'static';
                }

                /**
                 * returns the closest, non-statically positioned parentOffset of a given element
                 * @param element
                 */
                var parentOffsetEl = function(element) {
                    var docDomEl = $document[0];
                    var offsetParent = element.offsetParent || docDomEl;
                    while (offsetParent && offsetParent !== docDomEl && isStaticPositioned(offsetParent)) {
                        offsetParent = offsetParent.offsetParent;
                    }
                    return offsetParent || docDomEl;
                };

                return {
                    /**
                     * Provides read-only equivalent of jQuery's position function:
                     * http://api.jquery.com/position/
                     */
                    position: function(element) {
                        var elBCR = this.offset(element);
                        var offsetParentBCR = {top: 0, left: 0};
                        var offsetParentEl = parentOffsetEl(element[0]);
                        if (offsetParentEl != $document[0]) {
                            offsetParentBCR = this.offset(angular.element(offsetParentEl));
                            offsetParentBCR.top += offsetParentEl.clientTop - offsetParentEl.scrollTop;
                            offsetParentBCR.left += offsetParentEl.clientLeft - offsetParentEl.scrollLeft;
                        }

                        var boundingClientRect = element[0].getBoundingClientRect();
                        return {
                            width: boundingClientRect.width || element.prop('offsetWidth'),
                            height: boundingClientRect.height || element.prop('offsetHeight'),
                            top: elBCR.top - offsetParentBCR.top,
                            left: elBCR.left - offsetParentBCR.left
                        };
                    },
                    /**
                     * Provides read-only equivalent of jQuery's offset function:
                     * http://api.jquery.com/offset/
                     */
                    offset: function(element) {
                        var boundingClientRect = element[0].getBoundingClientRect();
                        return {
                            width: boundingClientRect.width || element.prop('offsetWidth'),
                            height: boundingClientRect.height || element.prop('offsetHeight'),
                            top: boundingClientRect.top + ($window.pageYOffset || $document[0].body.scrollTop || $document[0].documentElement.scrollTop),
                            left: boundingClientRect.left + ($window.pageXOffset || $document[0].body.scrollLeft || $document[0].documentElement.scrollLeft)
                        };
                    }
                };
            }]);

angular.module('ui.bootstrap.custom.bindHtml', [])

        .directive('bindHtmlUnsafe', function() {
            return function(scope, element, attr) {
                element.addClass('ng-binding').data('$binding', attr.bindHtmlUnsafe);
                scope.$watch(attr.bindHtmlUnsafe, function bindHtmlUnsafeWatchAction(value) {
                    element.html(value || '');
                });
            };
        });
angular.module('ui.bootstrap.custom.typeahead', ['ui.bootstrap.custom.position', 'ui.bootstrap.custom.bindHtml'])

        /**
         * A helper service that can parse typeahead's syntax (string provided by users)
         * Extracted to a separate service for ease of unit testing
         */
        .factory('typeaheadParser', ['$parse', function($parse) {

                //                      00000111000000000000022200000000000000003333333333333330000000000044000
                var TYPEAHEAD_REGEXP = /^\s*(.*?)(?:\s+as\s+(.*?))?\s+for\s+(?:([\$\w][\$\w\d]*))\s+in\s+(.*)$/;

                return {
                    parse: function(input) {

                        var match = input.match(TYPEAHEAD_REGEXP), modelMapper, viewMapper, source;
                        if (!match) {
                            throw new Error(
                                    "Expected typeahead specification in form of '_modelValue_ (as _label_)? for _item_ in _collection_'" +
                                    " but got '" + input + "'.");
                        }
                        return {
                            itemName: match[3],
                            source: $parse(match[4]),
                            viewMapper: $parse(match[2] || match[1]),
                            modelMapper: $parse(match[1])
                        };
                    }
                };
            }])

        .directive('typeahead', ['$compile', '$parse', '$q', '$timeout', '$document', '$position', 'typeaheadParser',
            function($compile, $parse, $q, $timeout, $document, $position, typeaheadParser) {

                var HOT_KEYS = [9, 13, 27, 38, 40];

                return {
                    require: 'ngModel',
                    link: function(originalScope, element, attrs, modelCtrl) {

                        //SUPPORTED ATTRIBUTES (OPTIONS)

                        //minimal no of characters that needs to be entered before typeahead kicks-in
                        var minSearch = originalScope.$eval(attrs.typeaheadMinLength) || 1;

                        //minimal wait time after last character typed before typehead kicks-in
                        var waitTime = originalScope.$eval(attrs.typeaheadWaitMs) || 0;

                        //should it restrict model values to the ones selected from the popup only?
                        var isEditable = originalScope.$eval(attrs.typeaheadEditable) !== false;

                        //binding to a variable that indicates if matches are being retrieved asynchronously
                        var isLoadingSetter = $parse(attrs.typeaheadLoading).assign || angular.noop;

                        //a callback executed when a match is selected
                        var onSelectCallback = $parse(attrs.typeaheadOnSelect);

                        var inputFormatter = attrs.typeaheadInputFormatter ? $parse(attrs.typeaheadInputFormatter) : undefined;

                        var appendToBody = attrs.typeaheadAppendToBody ? $parse(attrs.typeaheadAppendToBody) : false;

                        //INTERNAL VARIABLES

                        //model setter executed upon match selection
                        var $setModelValue = $parse(attrs.ngModel).assign;

                        //expressions used by typeahead
                        var parserResult = typeaheadParser.parse(attrs.typeahead);

                        var hasFocus;

                        //pop-up element used to display matches
                        var popUpEl = angular.element('<div typeahead-popup></div>');
                        popUpEl.attr({
                            matches: 'matches',
                            active: 'activeIdx',
                            select: 'select(activeIdx)',
                            query: 'query',
                            position: 'position'
                        });
                        //custom item template
                        if (angular.isDefined(attrs.typeaheadTemplateUrl)) {
                            popUpEl.attr('template-url', attrs.typeaheadTemplateUrl);
                        }

                        //create a child scope for the typeahead directive so we are not polluting original scope
                        //with typeahead-specific data (matches, query etc.)
                        var scope = originalScope.$new();
                        originalScope.$on('$destroy', function() {
                            scope.$destroy();
                        });

                        var resetMatches = function() {
                            scope.matches = [];
                            scope.activeIdx = -1;
                        };

                        var getMatchesAsync = function(inputValue) {

                            var locals = {$viewValue: inputValue};
                            isLoadingSetter(originalScope, true);
                            $q.when(parserResult.source(originalScope, locals)).then(function(matches) {

                                //it might happen that several async queries were in progress if a user were typing fast
                                //but we are interested only in responses that correspond to the current view value
                                if (inputValue === modelCtrl.$viewValue && hasFocus) {
                                    if (matches.length > 0) {

                                        scope.activeIdx = 0;
                                        scope.matches.length = 0;

                                        //transform labels
                                        for (var i = 0; i < matches.length; i++) {
                                            locals[parserResult.itemName] = matches[i];
                                            scope.matches.push({
                                                label: parserResult.viewMapper(scope, locals),
                                                model: matches[i]
                                            });
                                        }

                                        scope.query = inputValue;
                                        //position pop-up with matches - we need to re-calculate its position each time we are opening a window
                                        //with matches as a pop-up might be absolute-positioned and position of an input might have changed on a page
                                        //due to other elements being rendered
                                        scope.position = appendToBody ? $position.offset(element) : $position.position(element);
                                        scope.position.top = scope.position.top + element.prop('offsetHeight');

                                    } else {
                                        resetMatches();
                                    }
                                    isLoadingSetter(originalScope, false);
                                }
                            }, function() {
                                resetMatches();
                                isLoadingSetter(originalScope, false);
                            });
                        };

                        resetMatches();

                        //we need to propagate user's query so we can higlight matches
                        scope.query = undefined;

                        //Declare the timeout promise var outside the function scope so that stacked calls can be cancelled later 
                        var timeoutPromise;

                        //plug into $parsers pipeline to open a typeahead on view changes initiated from DOM
                        //$parsers kick-in on all the changes coming from the view as well as manually triggered by $setViewValue
                        modelCtrl.$parsers.unshift(function(inputValue) {

                            hasFocus = true;

                            if (inputValue && inputValue.length >= minSearch) {
                                if (waitTime > 0) {
                                    if (timeoutPromise) {
                                        $timeout.cancel(timeoutPromise);//cancel previous timeout
                                    }
                                    timeoutPromise = $timeout(function() {
                                        getMatchesAsync(inputValue);
                                    }, waitTime);
                                } else {
                                    getMatchesAsync(inputValue);
                                }
                            } else {
                                isLoadingSetter(originalScope, false);
                                resetMatches();
                            }

                            if (isEditable) {
                                return inputValue;
                            } else {
                                if (!inputValue) {
                                    // Reset in case user had typed something previously.
                                    modelCtrl.$setValidity('editable', true);
                                    return inputValue;
                                } else {
                                    modelCtrl.$setValidity('editable', false);
                                    return undefined;
                                }
                            }
                        });

                        modelCtrl.$formatters.push(function(modelValue) {

                            var candidateViewValue, emptyViewValue;
                            var locals = {};

                            if (inputFormatter) {

                                locals['$model'] = modelValue;
                                return inputFormatter(originalScope, locals);

                            } else {

                                //it might happen that we don't have enough info to properly render input value
                                //we need to check for this situation and simply return model value if we can't apply custom formatting
                                locals[parserResult.itemName] = modelValue;
                                candidateViewValue = parserResult.viewMapper(originalScope, locals);
                                locals[parserResult.itemName] = undefined;
                                emptyViewValue = parserResult.viewMapper(originalScope, locals);

                                return candidateViewValue !== emptyViewValue ? candidateViewValue : modelValue;
                            }
                        });

                        scope.select = function(activeIdx) {
                            //called from within the $digest() cycle
                            var locals = {};
                            var model, item;

                            locals[parserResult.itemName] = item = scope.matches[activeIdx].model;
                            model = parserResult.modelMapper(originalScope, locals);
                            $setModelValue(originalScope, model);
                            modelCtrl.$setValidity('editable', true);

                            onSelectCallback(originalScope, {
                                $item: item,
                                $model: model,
                                $label: parserResult.viewMapper(originalScope, locals)
                            });

                            resetMatches();

                            //return focus to the input element if a mach was selected via a mouse click event
                            element[0].focus();
                        };

                        //bind keyboard events: arrows up(38) / down(40), enter(13) and tab(9), esc(27)
                        element.bind('keydown', function(evt) {

                            //typeahead is open and an "interesting" key was pressed
                            if (scope.matches.length === 0 || HOT_KEYS.indexOf(evt.which) === -1) {
                                return;
                            }

                            evt.preventDefault();

                            if (evt.which === 40) {
                                scope.activeIdx = (scope.activeIdx + 1) % scope.matches.length;
                                scope.$digest();

                            } else if (evt.which === 38) {
                                scope.activeIdx = (scope.activeIdx ? scope.activeIdx : scope.matches.length) - 1;
                                scope.$digest();

                            } else if (evt.which === 13 || evt.which === 9) {
                                scope.$apply(function() {
                                    scope.select(scope.activeIdx);
                                });

                            } else if (evt.which === 27) {
                                evt.stopPropagation();

                                resetMatches();
                                scope.$digest();
                            }
                        });

                        element.bind('blur', function(evt) {
                            hasFocus = false;
                        });

                        // Keep reference to click handler to unbind it.
                        var dismissClickHandler = function(evt) {
                            if (element[0] !== evt.target) {
                                resetMatches();
                                scope.$digest();
                            }
                        };

                        $document.bind('click', dismissClickHandler);

                        originalScope.$on('$destroy', function() {
                            $document.unbind('click', dismissClickHandler);
                        });

                        var $popup = $compile(popUpEl)(scope);
                        if (appendToBody) {
                            $document.find('body').append($popup);
                        } else {
                            element.after($popup);
                        }
                    }
                };

            }])

        .directive('typeaheadPopup', function() {
            return {
                restrict: 'EA',
                scope: {
                    matches: '=',
                    query: '=',
                    active: '=',
                    position: '=',
                    select: '&'
                },
                replace: true,
                templateUrl: 'template/typeahead/typeahead-popup.html',
                link: function(scope, element, attrs) {

                    scope.templateUrl = attrs.templateUrl;

                    scope.isOpen = function() {
                        return scope.matches.length > 0;
                    };

                    scope.isActive = function(matchIdx) {
                        return scope.active == matchIdx;
                    };

                    scope.selectActive = function(matchIdx) {
                        scope.active = matchIdx;
                    };

                    scope.selectMatch = function(activeIdx) {
                        scope.select({activeIdx: activeIdx});
                    };
                }
            };
        })

        .directive('typeaheadMatch', ['$http', '$templateCache', '$compile', '$parse', function($http, $templateCache, $compile, $parse) {
                return {
                    restrict: 'EA',
                    scope: {
                        index: '=',
                        match: '=',
                        query: '='
                    },
                    link: function(scope, element, attrs) {
                        var tplUrl = $parse(attrs.templateUrl)(scope.$parent) || 'template/typeahead/typeahead-match.html';
                        $http.get(tplUrl, {cache: $templateCache}).success(function(tplContent) {
                            element.replaceWith($compile(tplContent.trim())(scope));
                        });
                    }
                };
            }])

        .filter('typeaheadHighlight', function() {

            function escapeRegexp(queryToEscape) {
                return queryToEscape.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
            }

            return function(matchItem, query) {
                return query ? matchItem.replace(new RegExp(escapeRegexp(query), 'gi'), '<strong>$&</strong>') : matchItem;
            };
        });
angular.module("template/typeahead/typeahead-match.html", []).run(["$templateCache", function($templateCache) {
        $templateCache.put("template/typeahead/typeahead-match.html",
                "<a tabindex=\"-1\" bind-html-unsafe=\"match.label | typeaheadHighlight:query\"></a>");
    }]);

angular.module("template/typeahead/typeahead-popup.html", []).run(["$templateCache", function($templateCache) {
        $templateCache.put("template/typeahead/typeahead-popup.html",
                "<ul class=\"dropdown-menu\" ng-style=\"{display: isOpen()&&'block' || 'none', top: position.top+'px', left: position.left+'px'}\">\n" +
                "    <li ng-repeat=\"match in matches\" ng-class=\"{active: isActive($index) }\" ng-mouseenter=\"selectActive($index)\" ng-click=\"selectMatch($index)\">\n" +
                "        <div typeahead-match index=\"$index\" match=\"match\" query=\"query\" template-url=\"templateUrl\"></div>\n" +
                "    </li>\n" +
                "</ul>");
    }]);

angular.module("template/typeahead/typeahead.html", []).run(["$templateCache", function($templateCache) {
        $templateCache.put("template/typeahead/typeahead.html",
                "<ul class=\"typeahead dropdown-menu\" ng-style=\"{display: isOpen()&&'block' || 'none', top: position.top+'px', left: position.left+'px'}\">\n" +
                "    <li ng-repeat=\"match in matches\" ng-class=\"{active: isActive($index) }\" ng-mouseenter=\"selectActive($index)\">\n" +
                "        <a tabindex=\"-1\" ng-click=\"selectMatch($index)\" ng-bind-html-unsafe=\"match.label | typeaheadHighlight:query\"></a>\n" +
                "    </li>\n" +
                "</ul>");
    }]);

//</editor-fold>

angular.module("NgTagsInput", ["NgTagsInput.tpls", "NgTagsInput.tagsinput", "ui.bootstrap.custom"]);
angular.module("NgTagsInput.tpls", ["template/tagsinput.html"]);
angular.module("NgTagsInput.tagsinput", [])
        .controller('tagsController', ['$scope', '$attrs', function($scope, $attrs, $filter, $rootScope) {
                $scope.$on("typeahead-select", function() {
                    setTimeout(function() {
                        $scope.$apply(addTag);
                    });
                });
                var typeahead_enabled = ("tagTypeahead" in $attrs);
                $scope.delete = ('deleteIcon' in $attrs);
                $scope.animations = ('animate' in $attrs);
                $scope.placeholder = $attrs.placeholder;
                var minlength = $attrs.min ? parseInt($attrs.min) : 2;
                $scope.newTag = "";
                $scope.deleteIndex = -1;
                $scope.containsIndex = -1;
                //<editor-fold defaultstate="collapsed" desc="HANDLE KEYDONW EVENT">
                $scope.handleKeypress = function($event) {
                    var keycode = $event.keyCode;
                    switch (keycode) {
                        case 13: // ENTER
                            $scope.containsIndex = $scope.tags.indexOf($scope.newTag);
                            $event.preventDefault();
                            addTag();
                            break;
                        case 8: // BACKSPACE
                            deleteTag();
                            break;
                        case 9: // TAB
                            $scope.deleteIndex = -1;
                            $scope.element.removeClass("focus");
                            break;
                        case 65:
                            if ($event.ctrlKey)
                                $scope.selectAll = true;
                            else
                                $scope.selectAll = false;
                            break;
                    }
                };

                //</editor-fold>
                //<editor-fold defaultstate="collapsed" desc="TAG FUNCTIONS">
                function addTag() {
                    if ($scope.newTag.length >= minlength) {
                        if (typeahead_enabled) {
                            if ($scope.tags.indexOf($scope.newTag) !== -1) {
                                blinkTags();
                            } else {
                                for (i = 0; i < $scope.options.length; i++) {
                                    if ($scope.options[i].value === $scope.newTag) {
                                        $scope.tags.push($scope.newTag);
                                        $scope.newTag = "";
                                    }
                                }
                            }
                        } else {
                            if ($scope.tags.indexOf($scope.newTag) !== -1) {
                                blinkTags();
                            } else {
                                $scope.tags.push($scope.newTag);
                                $scope.newTag = "";
                            }
                        }
                    }
                }
                ;
                $scope.newTagChange = function() {
                    $scope.containsIndex = $scope.tags.indexOf($scope.newTag);
                    $scope.deleteIndex = -1;
                    $scope.selectAll = false;
                    setTimeout(function() {
                        blinkTags();
                    });
                };
                function deleteTag() {
                    if ($scope.selectAll) {
                        $scope.tags.splice(0, $scope.tags.length);
                        $scope.selectAll = false;
                    } else {
                        if ($scope.newTag.length === 0) {
                            if ($scope.deleteIndex === -1) {
                                $scope.deleteIndex = $scope.tags.length - 1;
                            } else {
                                $scope.removeTag($scope.tags[$scope.deleteIndex]);
                                $scope.deleteIndex = -1;
                            }
                        }
                    }
                }
                ;

                $scope.removeTag = function(tag) {
                    $scope.tags.splice($scope.tags.indexOf(tag), 1);
                };
                //</editor-fold>
                blinkTags = function() {
                };
            }])
        .directive('ngTags', function($parse) {
            return {
                restrict: 'EA',
                controller: 'tagsController',
                templateUrl: 'template/tagsinput.html',
                transclude: true,
                replace: true,
                scope: {
                    type: '=',
                    close: '&'
                },
                link: function(scope, element, attrs, controller) {
                    scope.element = element;

                    if ("tagTypeahead" in attrs) {
                        var TYPEAHEAD_REGEXP = /^\s*(.*?)(?:\s+as\s+(.*?))?\s+for\s+(?:([\$\w][\$\w\d]*))\s+in\s+(.*)$/;
                        var match = attrs.tagTypeahead.match(TYPEAHEAD_REGEXP);
                        var options = scope.$parent[match[4]];
                        var label = match[2];
                        var value = match[1];

                    }
                    var elements = element[0].childNodes;
                    var input;
                    for (i = 0; i < elements.length; i++) {
                        if (elements[i].nodeName === "INPUT") {
                            input = $(elements[i]);
                        }
                    }
                    $(element).click(function(event) {
                        event.stopPropagation();
                        if (!$(input).is(":focus")) {
                            input.show(0);
                            input.focus();
                            $(element).addClass("focus");
                        }
                    });
                    input.focus(function() {
                        $(element).addClass("focus");
                    });
                    input.blur(function() {
                        $(element).removeClass("focus");
                        if (!("placeholder" in attrs)) {
                            input.hide(0);
                        }
                    });
                    scope.tags = scope.$parent[attrs.ngTags];

                    scope.options = [];
                    if (typeof value !== "undefined") {
                        if (value.indexOf(".") !== -1) {
                            for (i = 0; i < options.length; i++) {
                                scope.options.push({value: options[i][value.split(".")[1]], label: null});
                            }
                        } else {
                            for (i = 0; i < options.length; i++) {
                                scope.options.push({value: options[i], label: null});
                            }
                        }
                    }
                    if (typeof label !== "undefined") {
                        if (label.indexOf("." !== -1)) {
                            for (i = 0; i < scope.options.length; i++) {
                                scope.options[i].label = options[i][label.split(".")[1]];
                            }
                        } else {
                            for (i = 0; i < scope.options.length; i++) {
                                scope.options[i].label = options[i];
                            }
                        }
                    } else {
                        for (i = 0; i < scope.options.length; i++) {
                            scope.options[i].label = scope.options[i].value;
                        }
                    }
                }
            };
        });
angular.module("template/tagsinput.html", []).run(["$templateCache", function($templateCache) {
        $templateCache.put("template/tagsinput.html",
                "<div class='tags-input'>\n" +
                "<span ng-repeat='tag in tags' ng-class='{\"animate\":animations}'>" +
                "<span class='tag label' ng-class='{\"label-warning attention\": containsIndex === {{$index}}, \"animate\":animations, \"label-danger\": deleteIndex === {{$index}} || selectAll,  \"label-primary\": ($parent.params.containsIndex !== $index && $parent.params.deleteIndex !== $index)}'>" +
                "<span class='tag-text'>{{tag}}</span>" +
                " <span class='glyphicon glyphicon-remove hover' ng-if='delete' ng-click='removeTag(tag)'></span> " +
                "</span>" +
                "</span>&nbsp;" +
                "<input type='text' ng-keydown='handleKeypress($event)' ng-model='newTag' typeahead='o.value as o.label for o in options | filter:$viewValue | limitTo:8'  ng-change='newTagChange()' placeholder='{{placeholder}}' class='tag-input'/>\n" +
                "</button></div>");
    }]);